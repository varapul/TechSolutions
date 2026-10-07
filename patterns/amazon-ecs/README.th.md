## ปัญหา

service Catalog ของ Acme Shop ส่งออกมาเป็น container image: CI build `catalog:1.4.2` ครั้งเดียวแล้ว push ไปที่ Amazon ECR (ดู [Docker](../docker/)) แต่ image ไม่ได้รันตัวเอง ใน production ตัว service ต้องมีหลาย copy กระจายอยู่ในสอง Availability Zone ต้องมี load balancer ที่ส่ง request ไปให้เฉพาะ copy ที่ทำงานได้ ต้องมีตัวแทนเมื่อตัวไหนตาย ต้องเพิ่ม copy เมื่อ traffic ช่วงเย็นมาถึง ต้อง roll out เวอร์ชันใหม่โดยไม่มี downtime ต้องได้สิทธิ์ AWS โดยไม่ต้องฝัง key ไว้ใน image และต้องมี log รวมอยู่ที่เดียว ถ้าใช้ EC2 instance เปล่า ๆ เราต้องเขียน script ทำทั้งหมดนี้เอง แถมต้อง patch host เองด้วย ส่วน [Kubernetes](../kubernetes/) ก็ทำงานนี้ได้ แต่ตัวมันเองก็เป็น platform ที่ต้องรันและต้องเรียนรู้อีกก้อนหนึ่ง Amazon ECS คือ container orchestrator ของ AWS เอง ส่วน AWS Fargate ก็รัน container ของมันโดยไม่มี server ให้เราต้องดูแล

## ทำงานยังไง

### ชิ้นส่วนต่าง ๆ

| Concept | คืออะไร | Acme Shop |
|---|---|---|
| **Cluster** | กลุ่มของ service และ task ในเชิง logical รวมกับ capacity ที่พวกมันรันอยู่ | `acme-shop` ใน us-east-1 |
| **Task definition** | เอกสาร JSON ที่อธิบาย container หนึ่งตัวหรือมากกว่า: image, CPU และ memory, port, network mode, logging, environment และ secret และ IAM role สองตัว การเรียก `RegisterTaskDefinition` แต่ละครั้งจะเพิ่ม revision ใหม่ที่แก้ไม่ได้ (immutable) เข้าไปใน family | `catalog:7` แล้วต่อมาเป็น `catalog:8` |
| **Task** | copy ของ task definition ที่กำลังรันอยู่: container ของมันที่ถูกเริ่มพร้อมกันบน host เดียว หรือใน Fargate environment เดียว | 3 ตัว และได้ถึง 10 ตัว |
| **Service** | คอยให้ task รันอยู่ตามจำนวนที่ต้องการ เปลี่ยน task ที่หยุดหรือไม่ผ่าน health check, register task เข้า target group ของ load balancer และ roll out revision ใหม่ | `catalog`, desired count 3 |
| **Capacity provider** | ที่ที่ task ได้ compute มา: `FARGATE`, `FARGATE_SPOT`, EC2 Auto Scaling group หรือ ECS Managed Instances ตัว capacity provider strategy กระจาย task ไปตาม provider ต่าง ๆ โดยกำหนด `base` และ `weight` ให้แต่ละตัว | `FARGATE` |
| **Launch type** | วิธีเลือก compute ให้ task หรือ service แบบเก่าที่ง่ายกว่า: `FARGATE`, `EC2` หรือ `EXTERNAL` สำหรับ server ของเราเองที่ register ผ่าน ECS Anywhere ส่วน Managed Instances ต้องใช้ capacity provider strategy | ไม่ได้ใช้ |

### Fargate, Fargate Spot, EC2 และ Managed Instances

- **Fargate** เราเลือก CPU และ memory ของ task จากตารางที่กำหนดไว้ ตั้งแต่ 0.25 vCPU กับ 0.5 ถึง 2 GB ไปจนถึง 32 vCPU กับ 60, 120 หรือ 244 GB (Linux, ตุลาคม 2026 โดยขนาดตั้งแต่ 8 vCPU ขึ้นไปต้องใช้ platform version 1.4.0 ที่ `LATEST` ชี้ไป) task แต่ละตัวรันอยู่ใน isolation boundary ของตัวเอง และไม่แชร์ kernel, CPU, memory หรือ network interface กับ task อื่น ตัว AWS รันและ patch host ให้ และ task แต่ละตัวได้ ephemeral storage 20 GB ที่ขยายได้ถึง 200 GB ส่วนที่ต้องแลกคือ ไม่มี host ให้เข้าไป ไม่มี service แบบ `DAEMON` ไม่มี privileged container ไม่มี GPU และ `awsvpc` เป็น network mode เดียวที่ใช้ได้
- **Fargate Spot** รัน task ที่ทนการถูกขัดจังหวะได้บน capacity ที่ว่างอยู่ ในราคาต่ำกว่าราคา Fargate ได้ถึง 70% เมื่อ AWS ต้องการ capacity คืน ตัว task จะได้คำเตือนล่วงหน้าสองนาที ในรูปของ task state change event ของ [EventBridge](../amazon-eventbridge/) และ `SIGTERM` ตัว Fargate ไม่ถอยกลับไปใช้ capacity แบบ on-demand ให้เอง ทำให้ strategy ส่วนใหญ่เก็บ task จำนวน `base` ไว้บน `FARGATE` แล้ววาง task ส่วนเกินไว้บน `FARGATE_SPOT`
- **EC2 instance** คือ Auto Scaling group ของ container instance ที่ปกติรัน ECS-optimized AMI พร้อม ECS agent และผูกเข้ากับ cluster เป็น capacity provider ถ้าเปิด **managed scaling** ไว้ ECS จะ publish metric `CapacityProviderReservation` แล้วขยายหรือย่อ group เพื่อคุมให้อยู่ที่ `targetCapacity` (ค่า default 100%) ทำให้จำนวน instance ตามจำนวน task ไป เราได้ instance type แบบไหนก็ได้ รวมถึง GPU แล้วก็ได้ service แบบ `DAEMON`, privileged container และ network mode `bridge` กับ `host` แต่ AMI, การ patch และการเปลี่ยน instance ก็เป็นงานของเรา
- **ECS Managed Instances** (ตั้งแต่ 30 กันยายน 2025) อยู่ตรงกลาง โดยที่ ECS จะ launch และรัน EC2 instance ใน account ของเรา: ค่า default คือ type แบบ general-purpose ที่ถูกที่สุดที่พอดี หรือจะเป็น type และ attribute ที่เราขอก็ได้ (GPU, ยี่ห้อ CPU, memory) แล้ว task หลายตัวก็ใช้ instance ร่วมกัน และ AWS ก็ patch instance และเปลี่ยนมันเป็นระยะ ฝั่ง task definition ต้องใส่ `MANAGED_INSTANCES` เพิ่มใน `requiresCompatibilities` และ task definition ของ Fargate สำหรับ platform version 1.4.0 ก็ใช้กับมันได้ เราจ่ายค่า instance บวกค่า management fee ต่อ instance

### Networking

- **`awsvpc`** ให้ task ทุกตัวมี elastic network interface (ENI) ของตัวเอง พร้อม private IP address จาก subnet ที่เราเลือก ทำให้ security group มีผลกับ task แต่ละตัว ส่วน task ของ Acme Shop อยู่ใน private app subnet `10.0.10.0/24` และ `10.0.11.0/24` และ security group `app-sg` ของมันรับ port 8080 จาก `alb-sg` ของ load balancer เท่านั้น (ดู [Amazon VPC](../amazon-vpc/)) นี่เป็น mode เดียวบน Fargate ส่วนบน EC2 instance ตัว ENI ของแต่ละ task จะกิน network interface ของ instance ไปหนึ่งตัว แล้ว ENI trunking (account setting `awsvpcTrunking`) ก็ช่วยเลี่ยงข้อจำกัดนี้ได้
- **`bridge`** เป็นค่า default ของ Linux task บน EC2 instance และใช้ virtual network ของ Docker บน host ส่วน **`host`** ใช้ network stack ของ instance เอง ทำให้ task สองตัวบน instance เดียวกันใช้ port เดียวกันไม่ได้ ส่วน **`none`** ไม่มี network ภายนอกเลย
- **Service คุยกับ service** ถ้าใช้ **Service Connect** ตัว ECS จะเพิ่ม Service Connect proxy เข้าไปในทุก task ของ service ที่อยู่ใน namespace ของ AWS Cloud Map แล้ว client ก็เรียกชื่อสั้น ๆ อย่าง `http://catalog:8080` ส่วน proxy เลือก task ที่ healthy ด้วย round robin และ outlier detection และทุก service ก็รายงาน traffic metric ชุดเดียวกัน แบบนี้ไม่ต้องใช้ [Route 53](../amazon-route-53/) hosted zone ส่วน **service discovery** แบบเก่า register แต่ละ task ไว้ใน Cloud Map และ Route 53 private DNS แล้ว client ก็ resolve ชื่อเอง นอกจากนี้ service ยัง join VPC Lattice ได้ด้วย

### Load balancing และ health check

ตัว service register แต่ละ task เข้า target group ของมันระหว่างที่ task เป็น `ACTIVATING` และ deregister ระหว่างที่ task เป็น `DEACTIVATING` ส่วน task ใน mode `awsvpc` จะถูก register ด้วย IP address ทำให้ target group ของมันต้องมี target type เป็น `ip` ส่วน target แบบ `ip` นั้น ALB จะเช็กแต่ละ target ทุก 30 วินาทีเป็นค่า default รอคำตอบ 5 วินาที ตัดสินว่า target unhealthy หลัง fail 2 ครั้งติดกัน และให้กลับมา healthy หลังผ่าน 5 ครั้ง ส่วน target ที่เพิ่ง register ต้องผ่านแค่ครั้งเดียว เมื่อ target กลายเป็น unhealthy ตัว ECS จะเปลี่ยน task: ถ้า `maximumPercent` ยังเหลือที่ มันจะเริ่มตัวแทนก่อน แล้วหยุด task เก่าเมื่อตัวใหม่ healthy แล้ว แต่ถ้าไม่เหลือที่ มันจะหยุด task ที่ unhealthy ไปหนึ่งตัวก่อน ค่า `healthCheckGracePeriodSeconds` (default 0) บอก ECS ให้ไม่สนใจ check ที่ fail ช่วงหนึ่งหลัง task เริ่ม และตัวที่เริ่มช้าก็ต้องใช้ค่านี้ ส่วน container health check ใน task definition ใช้ได้ทั้งแบบมีและไม่มี load balancer

การหยุด task ก็ใช้เวลาเหมือนกัน load balancer จะเก็บ target ที่ถูก deregister ไว้ในสถานะ `draining` ตลอด **deregistration delay** (ค่า default 300 วินาที) เพื่อให้ request ที่ in flight ทำเสร็จ จากนั้น ECS ก็ส่ง stop signal ให้ container (`SIGTERM` ถ้า image ไม่ได้ตั้งตัวอื่นไว้) แล้วพอครบ stop timeout (ค่า default 30 วินาที บน Fargate ได้มากสุด 120 วินาที) ก็ส่ง `SIGKILL`

### IAM role สองตัว

- **task role** (`taskRoleArn` ที่นี่คือ `catalog-task`) ถือสิทธิ์ของโค้ดแอป ตัว AWS SDK ใน container หยิบ temporary credential ของมันไปใช้เองอัตโนมัติ ทำให้ไม่มี key ไปอยู่ใน image หรือใน environment
- **task execution role** (`executionRoleArn` ที่นี่คือ `catalog-execution`) คือ role ที่ ECS container agent หรือ Fargate ใช้ดึง image จาก ECR repository แบบ private ส่ง log ของ `awslogs` ไปที่ [CloudWatch](../amazon-cloudwatch/) และอ่าน secret ของ Secrets Manager กับ parameter ของ Parameter Store ที่ task definition อ้างถึง ส่วน AWS managed policy `AmazonECSTaskExecutionRolePolicy` ครอบคลุมการดึง image และ log
- role ทั้งสองตัว trust service principal `ecs-tasks.amazonaws.com` (ดู [AWS IAM](../aws-iam/)) บน Fargate นั้น task แต่ละตัวแยกขาดจากกัน แต่บน EC2 instance, Managed Instances และ ECS Anywhere ไม่ใช่แบบนั้น: container อาจเข้าถึง credential ของ task อื่นบน instance เดียวกัน, instance role และ instance metadata service ได้ ทำให้ AWS แนะนำให้ block container ไม่ให้เข้าถึง metadata service บนพวกนี้

### Secret และ configuration

ส่วน `secrets` ของ container definition จับคู่ environment variable กับ ARN ของ secret ใน Secrets Manager หรือ parameter ใน Systems Manager Parameter Store (`valueFrom`) แล้ว ECS ก็ inject ค่าเข้าไปตอน container เริ่มทำงาน ส่วน secret ที่ถูก rotate แล้วจะไม่ไปถึง container ที่รันอยู่: ต้องเริ่ม task ใหม่ เช่นด้วย `update-service --force-new-deployment` ค่า setting ธรรมดาให้ใส่ใน `environment` หรือใน environment file บน [S3](../amazon-s3/) และถ้าอยากดูแนวคิดทั่วไป ให้ดู [external configuration store](../external-configuration-store/)

### Log

log driver **`awslogs`** ส่ง stdout และ stderr ของแต่ละ container ไปที่ CloudWatch Logs ที่นี่คือ group `/ecs/catalog` โดยแยกหนึ่ง stream ต่อหนึ่ง container ชื่อ `prefix/container/task-id` และบน Fargate ต้องใส่ `awslogs-stream-prefix` เสมอ ตั้งแต่ 25 มิถุนายน 2025 เป็นต้นมา delivery mode ที่เป็น default คือ `non-blocking`: log จะรออยู่ใน buffer (`max-buffer-size` ค่า default 10m) และเมื่อ buffer เต็ม บรรทัดใหม่จะถูกทิ้ง แทนที่จะทำให้แอปค้าง ให้ตั้ง `mode` เป็น `blocking` ตรงที่การเสีย log บางบรรทัดแย่กว่าการที่ container ค้าง ส่วน **FireLens** รัน Fluent Bit หรือ Fluentd เป็น sidecar ใน task (AWS publish image AWS for Fluent Bit ไว้ให้) แล้ว route log ไปที่อื่น: S3, [OpenSearch](../elasticsearch/), [Kinesis](../amazon-kinesis-data-streams/) หรือ service ของ partner (ดู [centralized logging](../centralized-logging/))

### Scaling

- **Service auto scaling** เปลี่ยน desired count ผ่าน Application Auto Scaling ตัว **target tracking** คุม metric ให้อยู่ใกล้ target โดย metric ที่กำหนดมาให้แล้วคือ `ECSServiceAverageCPUUtilization`, `ECSServiceAverageMemoryUtilization` และ `ALBRequestCountPerTarget` ส่วน metric CPU กับ memory แบบ high-resolution ใช้ข้อมูลทุก 20 วินาที ทางเลือกอื่นคือ step scaling, scheduled action และ predictive scaling
- CPU utilization ของ service คือ CPU ที่ task ของมันใช้ หารด้วย CPU ที่ task definition จองไว้ให้ task ทั้งหมด ตัว target tracking จะ scale out ตามสัดส่วนของ metric และปัดขึ้น ทำให้ task 3 ตัวที่ 85% เทียบกับ target 60% ต้องใช้ CPU เท่ากับ 3 × 85 ÷ 60 = 4.25 task: ก็คือ 5 task ที่ราว 51% ต่อตัว ส่วนตอน scale in มันจะช้ากว่า และทำแค่ตอนที่การเอา task ออกหนึ่งตัวจะไม่ดัน metric กลับไปเกิน target ค่า cooldown default ของ ECS service คือ 300 วินาที และ scale-in จะถูกพักไว้ระหว่างที่มี deployment อยู่
- บน EC2 capacity ตัว managed scaling (ด้านบน) จะเพิ่ม instance ที่ task ใหม่ต้องใช้ต่อ ส่วนบน Fargate ไม่มี instance ให้เพิ่ม มีแค่ quota: ค่า default ที่ระบุไว้ของ Fargate On-Demand vCPU คือ 6 ต่อ Region และปรับได้ ระหว่าง rollout ใน step 3 ตัว Catalog ใช้ 10 task × 0.5 vCPU = 5

### Deployment

- **Rolling update** (`ROLLING` คือ strategy default ของ deployment controller `ECS`) ตัว `minimumHealthyPercent` (default 100 ปัดขึ้น) คือจำนวน task ที่ต้อง healthy อยู่เสมอ และ `maximumPercent` (default 200 ปัดลง) คือจำนวนที่รันได้ ทั้งสองค่าเป็นเปอร์เซ็นต์ของ desired count สำหรับ Catalog ที่ 5 task แปลว่าต้องมี task ที่ healthy ไม่น้อยกว่า 5 ตัว และรวมกันไม่เกิน 10 ตัว ทำให้ ECS เริ่ม task ใหม่ทั้ง 5 ตัวพร้อมกัน และหยุดตัวเก่าก็ต่อเมื่อตัวใหม่ healthy ขึ้นมา ถ้าใช้ 75% และ 125% จะเปลี่ยนทีละหนึ่งหรือสองตัว โดยใช้ capacity สำรองน้อยกว่า
- **deployment circuit breaker** (`deploymentCircuitBreaker` ที่มี `enable` และ `rollback`) นับ task ที่ไปไม่ถึง `RUNNING` หรือไม่ผ่าน health check ของ load balancer, Cloud Map หรือ container ถ้าเกิน threshold มันจะตั้ง deployment เป็น `FAILED` และถ้าเปิด `rollback` ไว้ ก็จะ redeploy deployment ล่าสุดที่ `COMPLETED` ค่า default ของ threshold คือครึ่งหนึ่งของ desired count โดยคุมให้อยู่ระหว่าง 3 ถึง 200 (`BOUNDED_PERCENT` 50) ทำให้ของ Catalog เป็น 3 และนับเฉพาะ failure ที่ติดกัน (`resetOnHealthyTask`) ทางเลือกอื่นคือ `UNBOUNDED_PERCENT` และ `COUNT` แบบค่าคงที่ ส่วน **CloudWatch alarm** บน metric ของแอปก็ทำให้ deployment fail และ rollback ได้เหมือนกัน
- ตอนที่ deployment เริ่ม ECS จะ resolve image tag เป็น digest ทำให้ task ทุกตัวใน deployment เดียวกันรัน image ตัวเดียวกัน แม้จะมีคนย้าย tag ไปแล้วก็ตาม
- **Blue/green** ติดมากับ ECS ตั้งแต่กรกฎาคม 2025 โดยที่ task ของ revision ใหม่จะเริ่มอยู่หลัง target group ตัวที่สองฝั่ง green แล้ว listener rule ก็ส่ง test traffic ไปหามันได้ จากนั้น production traffic ย้ายไปในขั้นเดียว และ task ฝั่ง blue ยังรันต่อตลอด bake time ทำให้การ rollback เป็นแค่การสลับกลับอย่างเร็ว ส่วน lifecycle hook รัน function ของ [Lambda](../aws-lambda/) หรือพัก deployment ไว้ได้ ที่ stage ต่าง ๆ เช่นหลัง shift test traffic ส่วน deployment แบบ **linear** และ **canary** (ตุลาคม 2025) ย้าย traffic เป็นขั้นเท่า ๆ กันขั้นละ 3 ถึง 100% โดยรอหลังแต่ละขั้น หรือย้าย canary เปอร์เซ็นต์หนึ่งไปก่อน ทั้งสามแบบใช้กับ ALB, NLB, Service Connect หรือ VPC Lattice ได้ ส่วน deployment controller `CODE_DEPLOY` แบบเก่าที่รัน blue/green ผ่าน AWS CodeDeploy และ controller `EXTERNAL` ก็ยังใช้ได้อยู่
- **Availability Zone rebalancing** ตั้งแต่ 5 กันยายน 2025 เป็นต้นมา ECS เปิดมันให้ทุก service ที่เข้าเงื่อนไข: เมื่อ task ของ service กระจายไม่เท่ากัน เช่นหลัง zone หนึ่งฟื้นจาก outage แล้ว ECS จะเริ่ม task ใน zone ที่มีน้อยที่สุด และหยุด task ใน zone ที่มีมากที่สุด

### ECS Exec

`aws ecs execute-command` เปิด shell หรือรันคำสั่งใน container ที่รันอยู่ ผ่าน AWS Systems Manager Session Manager โดยไม่ต้องใช้ SSH และไม่ต้องเปิด inbound port ให้เปิดใช้ด้วย `--enable-execute-command` (มีผลกับ task ที่เริ่มหลังจากนั้น) ตัว task role ต้องมีสิทธิ์ `ssmmessages` และ task ใน private subnet ต้องมี route ไปหา Systems Manager ผ่าน NAT gateway หรือ VPC endpoint

### ราคา

ECS ไม่คิดเงินค่า orchestration ทั้งบน Fargate และ EC2: เราจ่ายค่า capacity ส่วน ECS Managed Instances คิดค่า management fee ต่อ instance เพิ่มจากราคา EC2 ตัว Fargate คิดเงินรายวินาที ขั้นต่ำหนึ่งนาที (ห้านาทีสำหรับ Windows) ตั้งแต่ตอนที่เริ่มดึง image จนถึงตอนที่ task หยุด ตาม vCPU และ memory ที่ task ขอไว้ ใน us-east-1 เดือนตุลาคม 2026 ราคาของ Linux/x86 คือ $0.000011244 ต่อ vCPU-second (ประมาณ $0.0405 ต่อชั่วโมง) และ $0.000001235 ต่อ GB-second (ประมาณ $0.0044 ต่อชั่วโมง) ส่วน Linux/Arm (Graviton) คือ $0.0000089944 และ $0.0000009889 ถูกกว่า 20% และ ephemeral storage ส่วนที่เกิน 20 GB ฟรีคิด $0.0000000308 ต่อ GB-second ส่วน task `catalog` หนึ่งตัว (0.5 vCPU, 1 GB) ตกวินาทีละ 0.5 × $0.000011244 + $0.000001235 = $0.000006857 ประมาณ $0.0247 ต่อชั่วโมง หรือ $18 ต่อเดือน ทำให้ 3 task ที่รันตลอดเวลาตกราว $54 ต่อเดือน ยังไม่รวม load balancer, log และ data transfer ส่วน Compute Savings Plans ก็ใช้กับ Fargate ได้เหมือนกัน

## อยู่ตรงไหนใน solution

- **Solution:** web application และ API หลัง Application Load Balancer, service ของระบบ [microservices](../microservices/) ที่หากันเจอผ่าน Service Connect, queue worker ที่ scale ตามความลึกของ queue ใน [Amazon SQS](../amazon-sqs/) แบบใน [web-queue-worker](../web-queue-worker/) และ [competing consumers](../competing-consumers/) และงาน batch หรืองานตามเวลาที่รัน task จนจบ (`RunTask` หรือ EventBridge Scheduler ตาม cron หรือ rate schedule)
- **Pattern ใน catalog นี้:** ตัวเลือก deployment ของ ECS implement [rolling updates](../rolling-update/), [blue-green deployment](../blue-green-deployment/) และ [canary releases](../canary-release/) และ service auto scaling ก็ implement [autoscaling](../autoscaling/) ถ้ามี ALB อยู่ข้างหน้า ตัว service จะได้ [load balancing](../load-balancing/) ไปที่ task ที่ healthy เท่านั้น และ ECS จะเปลี่ยน task ที่ไม่ผ่าน health check ([health endpoint monitoring](../health-endpoint-monitoring/)) ส่วน task ที่มีหลาย container คือวิธีที่ ECS รัน [sidecar](../sidecar/): ทั้ง log router ของ FireLens และ Service Connect proxy เป็น sidecar และ Service Connect ก็ให้ ECS service ได้ส่วนหนึ่งของสิ่งที่ [service mesh](../service-mesh/) มีให้ ส่วน revision ของ task definition ที่แก้ไม่ได้และผูกกับ image digest ก็เป็นไปตาม [immutable infrastructure](../immutable-infrastructure/)
- **ของที่อยู่ข้าง ๆ บ่อย ๆ:** Amazon ECR สำหรับ image ([Docker](../docker/)), Elastic Load Balancing, subnet และ security group ของ [Amazon VPC](../amazon-vpc/), role ของ [AWS IAM](../aws-iam/), log และ metric ของ CloudWatch, Secrets Manager และ Parameter Store, AWS Cloud Map, [Amazon RDS](../amazon-rds-aurora/) หรือ [DynamoDB](../amazon-dynamodb/) ที่อยู่หลัง service และ [Amazon SQS](../amazon-sqs/) สำหรับงานที่รอได้
- **Managed offering:** ECS เป็น managed service อยู่แล้ว โดยมี Fargate เป็น compute แบบ serverless และ Fargate ยังรัน pod ให้ Amazon EKS ด้วย ของที่ใกล้เคียงที่สุดบน cloud อื่นคือ Google Cloud Run และ Azure Container Apps

## ใช้ตอนไหนดี

ใช้ ECS เมื่อ workload รันบน AWS แพ็กมาเป็น container และอยากได้ orchestrator ที่ไม่ต้องติดตั้งหรือ upgrade อะไรเลย: web service, API และ worker ที่รันเป็นชั่วโมงหรือเป็นวัน ต้องการเกินขีดจำกัดของ Lambda หรือมีเป็น image อยู่แล้ว ให้เริ่มบน Fargate เว้นแต่จะต้องใช้สิ่งที่มันไม่มี แล้วค่อยย้าย service ที่ยุ่งทั้งวันไปที่ EC2 capacity หรือ Managed Instances เมื่อบิลบอกว่าควรย้าย เลือก Kubernetes บน EKS เมื่ออยากได้ API เดียวข้าม cloud และ data center, ecosystem ของ operator, Helm chart และ controller หรือมีทีมที่รันมันอยู่แล้ว และเลือก Lambda สำหรับงานสั้น ๆ แบบ event-driven ที่ไม่ควรเสียเงินเลยตอนว่าง

| | ECS บน Fargate | ECS บน EC2 | Amazon EKS | AWS Lambda |
|---|---|---|---|---|
| สิ่งที่เราดูแล | task definition และ service | เหมือนกัน บวก instance: AMI, การ patch, Auto Scaling group | Kubernetes object และการ upgrade cluster รวมถึง node ด้วย เว้นแต่ EKS Auto Mode หรือ Fargate จะรันให้ | function |
| สิ่งที่เรา deploy | task: container หนึ่งตัวหรือมากกว่า | task | pod จาก manifest หรือ Helm chart | function เป็น .zip archive หรือ container image |
| หน่วยใหญ่สุด | 32 vCPU และ 244 GB ต่อ task | ตาม instance type รวมถึง GPU | ตามขนาด node | 10,240 MB พร้อม CPU ตามสัดส่วน, 15 นาทีต่อ invocation |
| สิ่งที่ไม่มี | service แบบ `DAEMON`, privileged container, GPU | ไม่มีอะไรเป็นพิเศษ | บน EKS Fargate: DaemonSet และ GPU | งานที่รันนานเกิน 15 นาที |
| Scaling | service auto scaling: target tracking, step, scheduled, predictive | เหมือนกัน บวก managed scaling ของ instance | HorizontalPodAutoscaler บวก Cluster Autoscaler, Karpenter หรือ Auto Mode สำหรับ node | ต่อ request ลงไปได้ถึงศูนย์ |
| ราคา (us-east-1) | ต่อ vCPU-second และ GB-second ที่ขอ ไม่มีค่า ECS | ค่า instance (On-Demand, Savings Plans, Spot) ไม่มีค่า ECS | $0.10 ต่อ cluster-hour ใน standard support บวก node หรือ Fargate | ต่อ request บวก GB-second |
| รันที่อื่นได้ไหม | ไม่ได้: ใช้ได้แค่ ECS API | ECS Anywhere เพิ่ม server ของเราเองได้ แต่ยังสั่งงานจาก AWS | Kubernetes cluster ที่ conformant ตัวไหนก็ได้ | ไม่ได้: ใช้ได้แค่ Lambda API |

ตัวเลขจากเอกสารและหน้า pricing ของ Amazon ECS, AWS Fargate, Amazon EKS และ AWS Lambda ณ ตุลาคม 2026

## ได้อะไร เสียอะไร

- **ใช้ได้แค่บน AWS** task definition, service, capacity provider และ setting ของ deployment เป็น object ของ ECS API ตัว image ย้ายไปไหนก็ได้ แต่การย้าย service ไป cloud อื่นหรือไป Kubernetes แปลว่าต้องเขียน definition และ infrastructure code รอบ ๆ มันใหม่
- **Fargate ยอมเสีย control เพื่อแลกกับความสะดวก** ไม่มีการเข้าถึง host ไม่มี service แบบ `DAEMON` ไม่มี privileged container หรือ Linux capability เพิ่มนอกจาก `CAP_SYS_PTRACE` ไม่มี GPU และเลือก CPU กับ memory ได้แค่ตามคู่ในตาราง ตัว EC2 capacity provider ปลดข้อจำกัดทั้งหมดนี้ได้ แลกกับการต้องรัน instance เอง ส่วน Managed Instances ปลดข้อจำกัดเรื่อง GPU และ instance type และเพิ่มความสามารถแบบ privileged โดยที่ AWS รัน instance ให้
- **Fargate คิดราคาต่อ task ส่วน EC2 คิดต่อ instance** ที่ราคา On-Demand ใน us-east-1 ตัว 2 vCPU และ 4 GB บน Fargate (x86) ตกราว $0.0987 ต่อชั่วโมง ส่วน c7i.large ที่มี 2 vCPU และ 4 GiB ราคา $0.08925 และ 4 vCPU กับ 8 GB บน Fargate (Arm) ตกราว $0.158 ส่วน c7g.xlarge ราคา $0.145 สรุปคือ EC2 ถูกกว่าราว 10% เฉพาะตอนที่ instance ยังเต็มอยู่ และ instance ที่ว่างครึ่งหนึ่งก็แพงกว่า Fargate เมื่อคิดต่อ task ส่วนโหลดหนักที่สม่ำเสมอและอัด instance ได้แน่น โดยเฉพาะถ้าใช้ Savings Plans หรือ Spot จะถูกกว่าบน EC2 แต่ service ที่โหลดกระชากหรือ service เล็ก ๆ ปกติจะไม่เป็นแบบนั้น
- **ค่า default ทำให้ deploy ช้า** deregistration delay 300 วินาทีและ health check ทุก 30 วินาที เพิ่มเวลาให้ทุก rollout เป็นนาที ให้ลด delay ลงถ้า request สั้น และจูน check ให้เข้ากับ service
- **Quota** นอกจาก Fargate vCPU quota แล้ว service หนึ่งมี task ได้มากสุด 5,000 ตัว (1,000 ถ้าใช้ service discovery) ส่วน cluster หนึ่งมี service ได้ 5,000 ตัว และ task definition หนึ่งมี container ได้ 10 ตัว (ตุลาคม 2026)
- **Log อาจหายได้** ค่า default แบบ non-blocking ปกป้อง service จาก log destination ที่ช้า ด้วยการทิ้งบรรทัดเมื่อ buffer เต็ม

## ข้อควรรู้ตอนลงมือทำ

**Task definition** ตัวนี้คือ `catalog-7.json` แบบย่อ สำหรับ `aws ecs register-task-definition --cli-input-json file://catalog-7.json` ส่วน account ID และ suffix ของ secret เป็นตัวอย่าง:

```json
{
  "family": "catalog",
  "requiresCompatibilities": ["FARGATE"],
  "networkMode": "awsvpc",
  "cpu": "512",
  "memory": "1024",
  "runtimePlatform": { "operatingSystemFamily": "LINUX", "cpuArchitecture": "X86_64" },
  "taskRoleArn": "arn:aws:iam::111122223333:role/catalog-task",
  "executionRoleArn": "arn:aws:iam::111122223333:role/catalog-execution",
  "containerDefinitions": [
    {
      "name": "catalog",
      "image": "111122223333.dkr.ecr.us-east-1.amazonaws.com/catalog:1.4.2",
      "essential": true,
      "portMappings": [{ "containerPort": 8080, "protocol": "tcp" }],
      "secrets": [
        { "name": "DB_PASSWORD", "valueFrom": "arn:aws:secretsmanager:us-east-1:111122223333:secret:catalog/db-password-AbCdEf" }
      ],
      "logConfiguration": {
        "logDriver": "awslogs",
        "options": {
          "awslogs-group": "/ecs/catalog",
          "awslogs-region": "us-east-1",
          "awslogs-stream-prefix": "catalog"
        }
      }
    }
  ]
}
```

**Cluster, service และ scaling policy ของมัน** ID ของ subnet, security group และ target group เป็นตัวอย่าง:

```sh
aws ecs create-cluster --cluster-name acme-shop --capacity-providers FARGATE FARGATE_SPOT

aws ecs create-service --cluster acme-shop --service-name catalog \
  --task-definition catalog:7 --desired-count 3 \
  --capacity-provider-strategy capacityProvider=FARGATE,weight=1 \
  --network-configuration "awsvpcConfiguration={subnets=[subnet-0aaa1111,subnet-0bbb2222],securityGroups=[sg-0ccc3333],assignPublicIp=DISABLED}" \
  --load-balancers targetGroupArn=arn:aws:elasticloadbalancing:us-east-1:111122223333:targetgroup/catalog-tg/0123456789abcdef,containerName=catalog,containerPort=8080 \
  --health-check-grace-period-seconds 30 \
  --deployment-configuration "minimumHealthyPercent=100,maximumPercent=200,deploymentCircuitBreaker={enable=true,rollback=true}"

aws application-autoscaling register-scalable-target --service-namespace ecs \
  --scalable-dimension ecs:service:DesiredCount --resource-id service/acme-shop/catalog \
  --min-capacity 3 --max-capacity 10

aws application-autoscaling put-scaling-policy --service-namespace ecs \
  --scalable-dimension ecs:service:DesiredCount --resource-id service/acme-shop/catalog \
  --policy-name catalog-cpu-60 --policy-type TargetTrackingScaling \
  --target-tracking-scaling-policy-configuration \
  '{"TargetValue": 60.0, "PredefinedMetricSpecification": {"PredefinedMetricType": "ECSServiceAverageCPUUtilization"}}'
```

**Deploy และ debug** ให้ register `catalog-8.json` (ไฟล์เดียวกันแต่ใช้ image `catalog:1.5.0`) ชี้ service ไปที่ revision ใหม่ แล้วรอจน stable ส่วน ECS Exec เปิด shell ใน task หนึ่งตัว:

```sh
aws ecs register-task-definition --cli-input-json file://catalog-8.json
aws ecs update-service --cluster acme-shop --service catalog --task-definition catalog:8
aws ecs wait services-stable --cluster acme-shop --services catalog

aws ecs update-service --cluster acme-shop --service catalog --enable-execute-command --force-new-deployment
aws ecs execute-command --cluster acme-shop --task <task-id> --container catalog --interactive --command "/bin/sh"
```

- **private subnet ต้องมีทางไป AWS** task ที่ไม่มี public IP จะเข้าถึง ECR, CloudWatch Logs, Secrets Manager และ Systems Manager ผ่าน NAT gateway หรือ VPC endpoint ถ้าเป็น Fargate platform version 1.4.0 ก็แปลว่าต้องมี interface endpoint `ecr.api` และ `ecr.dkr` บวก S3 gateway endpoint เพราะ ECR ส่ง image layer มาจาก S3 และต้องมี endpoint สำหรับ CloudWatch Logs ด้วย
- **Shut down อย่างนุ่มนวล** ดัก `SIGTERM` แล้วหยุดรับงาน ทำงานที่ in flight ให้เสร็จ และ exit ก่อนถึง stop timeout ส่วน deregistration delay ของ target group ให้ตั้งไว้นานกว่า request ที่ช้าที่สุดนิดหน่อย
- **ให้ grace period กับตัวที่เริ่มช้า** JVM หรือการ warm up cache อาจใช้เวลานานกว่าที่ health check fail สองครั้งจะยอมให้ ตัว `healthCheckGracePeriodSeconds` กัน ECS ไม่ให้ kill task ที่ยังเริ่มไม่เสร็จ
- **หนึ่ง role ต่อหนึ่ง service** ให้ทุก service มี task role ของตัวเองที่มีแค่ call ที่มันเรียกจริง และให้ execution role มีแค่การดึง image, log และ secret ที่ task นั้นต้องใช้
- **Arm ถูกกว่า** ตั้ง `cpuArchitecture` เป็น `ARM64` และ build image แบบ multi-architecture (ดู [Docker](../docker/)) เพื่อจ่ายน้อยลง 20% บน Fargate
- **ดู signal ให้ถูกตัว** ตั้ง alarm ที่ `CPUUtilization` และ `MemoryUtilization` ของ service, `UnHealthyHostCount` และ `HTTPCode_Target_5XX_Count` ของ target group และ EventBridge event ของ deployment ที่ fail (`SERVICE_DEPLOYMENT_FAILED`) ส่วน CloudWatch Container Insights เพิ่ม metric ราย task
