## ปัญหา

ทุก service ต้องมีงานเดินท่อที่ไม่เกี่ยวกับ business logic ของมันเลย: เข้ารหัสและ retry การเรียก, ส่ง log, ดึง secret กับ setting และ export telemetry มีสองที่ที่ใครก็นึกออกว่าจะเอางานพวกนี้ไปไว้ และทั้งสองที่ก็เจ็บ

**ไว้ในแอปพลิเคชัน เป็น library** มันเร็วและเห็นทุกอย่างใน process แต่ต้องเขียนใหม่ทุกภาษาและทุก framework แล้วจะขึ้น production ได้ก็ต่อเมื่อ build และ deploy ทุก service ใหม่ และมันก็ผูกชะตากับแอปพลิเคชัน: memory leak ใน log shipper ตอนนี้ก็คือ memory leak ใน checkout service พอมีหลายภาษาและหลายสิบทีม ก็ไม่มีใครบอกได้ว่า service ไหนรันตัวแก้ของเดือนที่แล้วไปแล้วบ้าง

**ไว้ใน service แยก ที่ไหนสักแห่งบน network** มันเป็นอิสระ แต่อยู่ไกล: มี network call เพิ่มอีกหนึ่งครั้ง มีอีกหนึ่งอย่างที่ต้อง discover, authenticate ด้วย และ scale และมันอ่านไฟล์ในเครื่องของแอปพลิเคชันหรือเข้าถึง loopback interface ของแอปไม่ได้

ตัวช่วยควรอยู่ใกล้แอปพลิเคชันเท่ากับ library (host เดียวกัน, network identity เดียวกัน, ไฟล์เดียวกัน, อายุเท่ากัน) และแยกจากแอปพลิเคชันได้เท่ากับ service (code base ของตัวเอง, รอบ release ของตัวเอง, resource limit ของตัวเอง)

## ทำงานยังไง

**sidecar** คือ process ตัวช่วยที่ deploy ไว้ข้าง ๆ *ทุก instance* ของแอปพลิเคชัน ใน deployment unit เดียวกัน ใน Kubernetes หน่วยนั้นคือ pod ส่วนที่อื่นก็เป็น task ของ Amazon ECS, task group ของ Nomad, instance ของ Cloud Run หรือแค่ host เดียวกัน ชื่อนี้มาจากรถพ่วงข้างของมอเตอร์ไซค์: ยึดติดกับรถ ไปไหนก็ไปด้วย และไม่มีประโยชน์อะไรถ้าไม่มีรถ Azure Architecture Center เรียกมันอีกชื่อว่า pattern *sidekick*

เพราะทั้งสองรันอยู่ข้างกัน เลยทำงานร่วมกันได้โดยไม่ต้องมีโค้ดร่วมกันเลย:

- **ผ่าน `localhost`** container ใช้ network namespace เดียวกัน แอปพลิเคชันเลยเข้าถึงตัวช่วยได้ (และตัวช่วยก็เข้าถึงแอปพลิเคชันได้) ผ่าน loopback port ด้วย HTTP ธรรมดาหรือ gRPC ไม่ว่าฝั่งไหนจะเขียนด้วยภาษาอะไร
- **ผ่านไฟล์** volume ที่ mount ไว้ให้ทั้งคู่ ทำให้ฝั่งหนึ่งเขียนสิ่งที่อีกฝั่งอ่านได้: แอปพลิเคชันเขียนต่อท้าย log file แล้วตัวช่วยก็ส่งมันออกไป หรือตัวช่วยเขียน configuration file แล้วแอปพลิเคชันก็อ่าน
- **ด้วยการขวางอยู่บนเส้นทาง** proxy sidecar รับ connection ทั้งขาออกและขาเข้าของแอปพลิเคชัน แล้วเติมสิ่งที่แอปพลิเคชันไม่ได้ทำเองเข้าไป

โค้ดของแอปพลิเคชันเองไม่มี logic ของตัวช่วยอยู่เลย และปกติก็ไม่รู้ด้วยซ้ำว่ามีตัวช่วยอยู่

### pattern พี่น้องสามตัว และที่มาของชื่อ

คำศัพท์พวกนี้มาจากคนที่สร้าง Kubernetes โดย Brendan Burns อธิบายวิธีประกอบ container บน node เดียวกันไว้สามแบบ ในบล็อกโพสต์ของ Kubernetes ปี 2015 ที่เขียนหลังจากพูดที่ DockerCon และอธิบายอีกครั้งร่วมกับ David Oppenheimer ใน paper ที่ HotCloud ปี 2016:

| Pattern | ตัวช่วยทำอะไร | ตัวอย่าง |
|---|---|---|
| **Sidecar** | ในคำของ Burns ตัว sidecar "extend and enhance" container หลัก | log shipper หรือ process ที่คอยทำให้ไฟล์ในเครื่องตรงกับ repository |
| **Ambassador** | proxy connection ของแอปพลิเคชันออกไปหาโลกภายนอก แอปพลิเคชันเลยคุยแค่กับ `localhost` | proxy ที่เติม TLS กับ retry หรือ proxy ที่กระจาย request ไปตาม shard ของ cache |
| **Adapter** | แสดงแอปพลิเคชันต่อโลกภายนอกในรูปแบบมาตรฐาน | exporter ที่แปลง metric ของแอปพลิเคชันเองให้เป็น format ที่ระบบ monitoring ต้องการ |

ทุกวันนี้คำว่า *sidecar* มักใช้เรียกกลไกการ deploy ส่วน ambassador กับ adapter ใช้เรียกสิ่งที่ตัวช่วยตัวนั้นทำ: ambassador ก็ถูก deploy เป็น sidecar ส่วนใน animation ตัว proxy คือ ambassador ที่รับการเรียกขาเข้าด้วย ส่วน log shipper ก็คือตัวอย่างแรกของ paper นั้นเอง

paper ยังให้เหตุผลที่ควรแยกตัวช่วยไว้ใน container ของตัวเองด้วย: container เป็นหน่วยของการนับ resource, ของการแพ็กและความเป็นเจ้าของของทีม, ของการใช้ซ้ำ, ของการกักความเสียหาย และของการ deploy และมันก็บอกราคาของข้อสุดท้ายไว้ด้วย: ตัวช่วยกับแอปพลิเคชันถูก upgrade แยกกัน ทุกคู่ version ที่อาจมาเจอกันใน production เลยต้องทำงานได้

### อะไรใช้ร่วมกัน อะไรแยกกัน

| | pod ใช้ร่วมกัน | แยกกันในแต่ละ container |
|---|---|---|
| **Network** | network namespace เดียว: IP address เดียวกัน port space เดียวกัน `localhost` เดียวกัน (container สองตัวเลย listen port เดียวกันไม่ได้) | |
| **Storage** | แค่ volume ที่ mount ไว้ให้ทั้งคู่ | root file system ที่มาจาก image ของแต่ละ container เอง |
| **Lifecycle** | ถูก schedule, start, scale และลบไปเป็นหน่วยเดียว | container ที่ crash จะถูก restart เดี่ยว ๆ และแต่ละตัวมี probe ของตัวเอง |
| **Resource** | scheduler วาง pod ตามผลรวมของ request ของทุก container | แต่ละ container มี request และ limit ของ CPU กับ memory ของตัวเอง |
| **Process** | เลือกได้: ถ้าตั้ง `shareProcessNamespace: true` ทุก container จะเห็น process ของตัวอื่น | ค่า default: process namespace แยกกัน |
| **Identity** | service account ของ pod ที่ token ของมันถูก mount เข้าไปในทุก container โดย default | |

การแยกนี้คือสิ่งที่ library ให้ไม่ได้: sidecar ที่ใช้ memory เกิน limit จะโดน kill แล้ว restart โดยไม่ลาก process ของแอปพลิเคชันไปด้วย และ CPU limit ของมันก็กันไม่ให้มันแย่ง CPU จนเส้นทางของ request อดตาย

### Lifecycle และลำดับ

"start และ stop ไปพร้อมกัน" ซ่อนรายละเอียดสามข้อที่เป็นต้นเหตุของปัญหาส่วนใหญ่กับ sidecar:

- **ตอน startup** ตัวช่วยต้องทำงานได้แล้วก่อนที่แอปพลิเคชันจะต้องใช้ แอปพลิเคชันที่ start เร็วกว่า proxy ของมันจะไม่มี network ให้ใช้ในการเรียกช่วงแรก ๆ
- **ตอน shutdown** ตัวช่วยต้องอยู่นานกว่าแอปพลิเคชัน ไม่อย่างนั้น request สุดท้ายจะออกไปไม่ได้ และ log บรรทัดสุดท้ายก็ไม่เคยถูกส่ง
- **job ที่ทำเสร็จแล้ว** ต้องไม่ถูกตัวช่วยที่ไม่ยอม exit ทำให้ค้างอยู่

หลายปีที่ Kubernetes ไม่มีแนวคิดเรื่อง sidecar เลย ตัวช่วยก็เป็นแค่อีกรายการหนึ่งใน `containers`: ไม่มีอะไรทำให้แอปพลิเคชันรอมัน ตอน shutdown ก็ส่ง signal ไปหา container โดยไม่รับประกันลำดับ และ pod ของ Job ก็ไม่มีวันเสร็จตราบที่ตัวช่วยยังรันอยู่ ทีมต่าง ๆ เลยหาทางเลี่ยงด้วย hook `postStart` ที่รั้งแอปพลิเคชันไว้ hook `preStop` ที่หน่วงตัวช่วยไว้ และ script ที่สั่งให้ตัวช่วยเลิกทำงานเมื่อ job เสร็จ

**Native sidecar container** มาแทนทางเลี่ยงพวกนั้น sidecar ถูกประกาศเป็น init container ที่มี `restartPolicy: Always` feature นี้มาเป็น alpha ใน Kubernetes v1.28 (สิงหาคม 2023) เปิดเป็น default ตั้งแต่ v1.29 และ stable ตั้งแต่ v1.33 (เมษายน 2025) ทุก release ที่ยังได้รับการดูแลอยู่ในตุลาคม 2026 (ตัวใหม่สุดคือ v1.37) มี feature นี้ และปิดมันไม่ได้แล้ว มันเปลี่ยนสี่อย่าง:

- **Start** ตัว init container start ตามลำดับที่ลิสต์ไว้ ตัว kubelet จะไปต่อตัวถัดไป และสุดท้ายก็ไปที่ application container เมื่อ sidecar ถือว่า start แล้ว: ตอนที่ `startupProbe` ของมันสำเร็จ หรือทันทีที่ process ของมันรันถ้าไม่มี probe นี้ ส่วน init container ธรรมดาที่ลิสต์ไว้หลัง sidecar ก็ใช้มันได้แล้ว
- **Run** ตัว sidecar ถูก restart ทุกครั้งที่มัน exit ไม่ว่า restart policy ของ pod จะว่ายังไง มันมี startup, readiness และ liveness probe ได้ และ readiness ของมันก็นับรวมใน readiness ของ pod
- **Stop** ตัว kubelet ส่ง termination signal ไปหา sidecar หลังจาก application container ตัวสุดท้ายหยุดสนิทแล้วเท่านั้น และหยุดพวกมันในลำดับย้อนกลับ ถ้า grace period หมดก่อน ทุกอย่างที่เหลือจะโดน kill พร้อมกัน exit code ที่ไม่ใช่ศูนย์จาก sidecar ตอน shutdown เลยเป็นเรื่องปกติ
- **Job** ตัว sidecar ไม่ได้ทำให้ pod ของ Job ค้างไม่เสร็จ

platform อื่นก็มีแนวคิดเดียวกันในแบบของตัวเอง task definition ของ Amazon ECS ระบุ container ว่า `essential` และเรียงลำดับด้วยเงื่อนไข `dependsOn` (`START`, `COMPLETE`, `SUCCESS`, `HEALTHY`) ที่ใช้ย้อนกลับตอน shutdown ส่วน task ของ Nomad ที่มี block `lifecycle` กับ `sidecar = true` จะรันนานเท่ากับ task หลัก และถูกหยุดหลังจากพวกมัน แล้ว Cloud Run ก็ start container ของ instance หนึ่งตามลำดับที่ประกาศไว้ และรอ health check ของแต่ละตัวได้

### อัปเดตและใช้ซ้ำแยกกัน

เพราะตัวช่วยเป็น image แยก ทีมที่เป็นเจ้าของเลย release มันตามตารางของตัวเองได้ และ image เดียวกันก็ใช้ได้กับทุกภาษา นั่นคือ step ที่สามของ animation: proxy image เดียววางอยู่ข้าง service ที่เป็น Java, Go และ Python ถ้าเป็น library จะต้องมีสาม implementation ที่ต้องคอยทำให้เท่ากัน และต้อง build ทุก service ใหม่ทุกครั้งที่แก้

"ไม่ต้อง build ใหม่" ไม่ได้แปลว่า "ไม่ต้อง restart" ด้วยเครื่องมือทั่วไป (injector หรือ workload ที่ pod template เปลี่ยน) ตัว sidecar version ใหม่จะไปถึง workload ก็ตอนที่ pod ของมันถูกแทนที่: เป็น rolling restart ที่ไม่แตะ image ของแอปพลิเคชันเลย จนกว่าทุก workload จะ restart ครบ ทั้ง fleet ก็จะรัน sidecar หลาย version ปนกันอยู่

## ใช้ตอนไหนดี

- ความสามารถที่หลาย service ต้องใช้ในแบบเดียวกัน และมีมากกว่าหนึ่งภาษา: transport security, retry, การส่ง log, การส่ง secret, การ export telemetry
- ตัวช่วยที่ทีมอื่นเป็นเจ้าของ (platform, security, observability) และควร ship ตามตารางของตัวเอง
- แอปพลิเคชันที่แก้ไม่ได้หรือไม่อยากแก้: legacy code, image ของ third-party หรือ product ที่ไม่มีกลไกให้ต่อขยาย
- ตัวช่วยที่ต้องอยู่ในเครื่องเดียวกับ instance เพราะต้องใช้ไฟล์, loopback interface หรือ identity ของแอปพลิเคชัน
- ตัวช่วยที่ควรมี resource limit ของตัวเอง และควรพังได้โดยไม่ลากแอปพลิเคชันล่มไปด้วย

### Library, sidecar, node agent หรือ platform?

ความสามารถเดียวกันอยู่ได้สี่ที่:

| | Library | Sidecar | agent หนึ่งตัวต่อ node | Feature ของ platform |
|---|---|---|---|---|
| รันที่ | ใน process ของแอปพลิเคชัน | ข้าง ๆ แต่ละ instance ใน pod เดียวกัน | ครั้งเดียวบนทุก node | ใน platform |
| ภาษา | หนึ่ง implementation ต่อหนึ่งภาษา | ภาษาไหนก็ได้ | ภาษาไหนก็ได้ | ภาษาไหนก็ได้ |
| เห็นอะไร | ทุกอย่างใน process | network, ไฟล์ที่ mount และ identity ของ instance เดียว | ทุก workload บน node | สิ่งที่ platform เปิดให้เห็น |
| ต้นทุนโตตาม | ตัวแอปพลิเคชันเอง | จำนวน instance | จำนวน node | ไม่มีอะไรที่เราต้องดูแลเอง |
| version ใหม่ต้องใช้ | build ทุก service ใหม่ | restart ทุก pod | rollout ตัว agent | upgrade platform |
| ถ้าพัง กระทบ | process ของแอปพลิเคชัน | ตัวช่วยของ instance เดียว | ทุก workload บน node นั้น | ทุกคนบน platform |

### ตอนไหน library ดีกว่า

- **เส้นทางที่ performance สำคัญมาก** ทุกการเรียกที่ผ่าน sidecar ต้องถูก serialise, ข้าม loopback interface แล้วถูก parse อีกรอบ สำหรับ interface ที่คุยถี่หรือ latency สำคัญมาก การเรียกใน process ชนะ
- **การ integrate แบบลึก** บางเรื่องต้องใช้ความรู้ที่มีอยู่แค่ใน process: request ไหน retry ได้ปลอดภัย, user ปัจจุบันทำอะไรได้บ้าง, span เริ่มและจบตรงไหนในโค้ด เรื่อง tracing คือตัวอย่างที่เจอบ่อย: instrumentation เป็น library ส่วน Collector ที่อยู่ข้างแอปพลิเคชันแค่รับและส่งต่อสิ่งที่ library ผลิตออกมา (ดู [Telemetry Pipeline](../telemetry-pipeline/))
- **ภาษาเดียวและทีมเดียว** upgrade dependency ง่ายกว่าเพิ่ม container อีกตัวในทุก pod

### ตอนไหน agent หนึ่งตัวต่อ node ดีกว่า

- **เก็บ log ในระดับใหญ่** ถ้าแอปพลิเคชันเขียนลง standard output ตัว node ก็มี log file ของทุก container อยู่แล้ว และ agent หนึ่งตัวต่อ node (DaemonSet ใน Kubernetes) ก็เก็บให้ทุก pod ได้โดยไม่ต้องแตะ pod ไหนเลย คู่มือ logging ของ Kubernetes เตือนว่า logging agent ที่อยู่ใน sidecar อาจกิน resource มาก และ log ที่จัดการแบบนี้จะไม่โผล่ใน `kubectl logs` อีกต่อไป
- **อะไรก็ตามที่เกี่ยวกับ node มากกว่าแอปพลิเคชัน:** host metric, kubelet, container runtime
- **ต้นทุน** agent ยี่สิบตัวบนยี่สิบ node แทนที่จะเป็นสองร้อยตัวในสองร้อย pod

ราคาของ agent ราย node คือการใช้ร่วมกัน: มันให้บริการทุก tenant บน node, ต้องมีสิทธิ์ระดับ node, ตั้งค่ารายแอปพลิเคชันได้ไม่อิสระเท่า และพอพังก็ลาก workload ไปด้วยมากกว่า

### ตอนไหนควรให้ platform ทำ

ถ้า platform มีความสามารถนั้นอยู่แล้ว sidecar ก็แค่เพิ่มชิ้นส่วนเข้ามาอีก ตัว Kubernetes เอง mount Secret กับ ConfigMap เป็นไฟล์และ refresh ให้หลังมีการเปลี่ยน (ยกเว้นการ mount แบบ `subPath`) ตัว node เก็บ standard output ของทุก container ไว้เป็น log file อยู่แล้ว CSI driver ก็ mount secret จาก store ภายนอกได้ และ service mesh ก็มี data plane แบบไม่ใช้ sidecar ให้: ใน ambient mode ของ Istio ตัว proxy บนแต่ละ node มาแทน proxy ในแต่ละ pod (ดู [Service Mesh](../service-mesh/))

### ตอนไหนไม่ควรใช้

- **ตัวช่วยต้อง scale ต่างจากแอปพลิเคชัน** หรือถูกใช้ร่วมกันโดยหลายแอปพลิเคชัน แบบนั้นคือ service แยก
- **แอปพลิเคชันเล็ก หรือรันอยู่ไม่กี่ instance** overhead ต่อ instance กับชิ้นส่วนที่เพิ่มขึ้นอาจมากกว่าประโยชน์ของการแยก
- **interface ระหว่างสองตัวคุยกันถี่หรือ latency สำคัญมาก** ใช้ library
- **platform หรือ agent ราย node ทำงานนี้อยู่แล้ว**
- **เพื่อแบ่งแอปพลิเคชันเดียวเป็นสองส่วน** sidecar มีไว้สำหรับตัวช่วยที่อายุเท่ากับแอปพลิเคชัน business logic สองชิ้นที่บังเอิญคุยกันเยอะ ถ้าไม่ใช่ service เดียวก็เป็นสอง service
- **instance ที่ต้อง start เร็ว** เช่น workload ที่ scale จากศูนย์: ทุกการ start ตอนนี้ต้องรอ sidecar ด้วย

## ได้อะไร เสียอะไร

### Resource overhead และวิธีตั้งงบ

ทุก pod ต้องจ่ายซ้ำ animation ใช้ตัวเลขตัวอย่าง: proxy ที่ใช้ 0.1 CPU กับ 100 MB ใน 200 pod จะจอง 20 CPU กับ 20 GB ไว้ก่อนที่แอปพลิเคชันไหนจะได้ทำงานสักอย่าง ตัวเลขจริงขึ้นกับตัวช่วยและ traffic: ใน benchmark ของ Istio เอง (version 1.24, 1,000 request ต่อวินาที payload 1 KB) ตัว proxy sidecar หนึ่งตัวที่มี worker thread สองตัวใช้ประมาณ 0.20 vCPU กับ 60 MB

- **ให้ทุก sidecar มี request กับ limit ที่ระบุชัด** request ของ sidecar จะถูกบวกเข้ากับของ application container และผลรวมนั้นคือสิ่งที่ scheduler ใช้วาง pod และสิ่งที่ quota นับ injector มีค่า default และให้ override ราย workload ได้ เช่น annotation `sidecar.istio.io/proxyCPU` กับ `sidecar.istio.io/proxyMemory` ของ Istio
- **ระวัง quality-of-service class** pod จะเป็น `Guaranteed` ก็ต่อเมื่อทุก container รวม sidecar ด้วย มี CPU กับ memory limit เท่ากับ request ของมัน แค่มี container ที่ inject เข้ามาตัวเดียวที่ไม่มีค่าพวกนี้ ก็เปลี่ยน class ของทั้ง pod
- **ระวัง autoscaler** HorizontalPodAutoscaler ที่ตั้งเป้าตาม CPU utilisation จะคำนวณจากทุก container ใน pod และจะไม่ทำอะไรเลยกับ metric นั้นถ้ามี container ไหนไม่มี CPU request ส่วน metric แบบ `ContainerResource` (stable ตั้งแต่ Kubernetes v1.30) scale ตาม application container ตัวเดียว ส่วน [Autoscaling](../autoscaling/) เล่าส่วนที่เหลือไว้
- **หรือตั้งงบทั้ง pod ทีเดียว** resource ระดับ pod (beta ตั้งแต่ v1.34 และเปิดเป็น default) กำหนดงบ CPU กับ memory ก้อนเดียวที่ container ใช้ร่วมกัน

### hop เพิ่มอีกหนึ่ง

proxy sidecar เพิ่ม hop ให้ทุกการเรียกหนึ่ง hop และเป็นสอง hop ถ้าทั้งสองฝั่งมี sidecar ส่วน documentation ของ Istio บอกว่า latency ที่ sidecar mode ของมันเพิ่มเข้ามา เมื่อมี proxy ทั้งสองฝั่ง อยู่ที่ 0.63 ms (p90) ถึง 0.88 ms (p99) สำหรับการเรียกครั้งเดียวไม่เท่าไร แต่สำหรับสายการเรียกสิบทอดก็เริ่มรู้สึกได้ วัด tail latency ของตัวเองตอนที่มี sidecar อยู่ อย่าไปเชื่อ benchmark ของใคร

### Security: sidecar อยู่ใน trust boundary

- **มันเห็นทุกอย่างที่ pod เห็น** มันใช้ network namespace ร่วมกัน เลย connect ไปหาอะไรก็ได้ที่แอปพลิเคชัน bind ไว้กับ `localhost` รวมถึง endpoint สำหรับ admin และ debug และมัน listen บน port ของ pod ได้ มันอ่าน volume ทุกตัวที่ mount เข้ามาในตัวมัน และรันด้วย service account ของ pod
- **sidecar ที่โดนเจาะก็คือ pod ที่โดนเจาะ และกลับกันก็เหมือนกัน** traffic ระหว่างแอปพลิเคชันกับ proxy sidecar เป็น plaintext บน loopback interface และ secret ที่ agent เขียนลง shared volume ก็อ่านได้จากทุก container ที่ mount volume นั้น pattern นี้ย้ายโค้ดออกจากแอปพลิเคชัน แต่ไม่ได้ย้ายออกจากรัศมีความเสียหายของแอปพลิเคชัน
- **การ inject คือ supply chain** sidecar มักถูกเพิ่มโดย mutating admission webhook ตอนสร้าง pod ใครคุม webhook นั้น, configuration ของมัน หรือ sidecar image ก็ได้รันโค้ดในทุก pod ให้ pin image version, จำกัดคนที่แก้ injector ได้ และ review สิ่งที่มันเพิ่มเข้าไป
- **สิทธิ์** proxy ที่ดัก traffic แบบโปร่งใสต้องเขียน packet routing ของ pod ใหม่ ตัว init container ของ Istio ต้องใช้ capability `NET_ADMIN` กับ `NET_RAW` เพื่อการนี้ ยกเว้นจะให้ CNI node agent ของมันทำแทน อย่าให้ sidecar มีสิทธิ์มากกว่าแอปพลิเคชัน
- **mount ให้น้อย** ให้ sidecar แค่ volume ที่มันต้องใช้ และเป็น read-only ถ้ามันแค่อ่าน

ด้านดีคือ sidecar เพิ่ม security control อย่าง [Mutual TLS](../mutual-tls/) ให้แอปพลิเคชันที่ไม่มีได้ โดยไม่ต้องแก้แอปพลิเคชัน

### Debug สอง process

- **ถามว่า container ไหน** log, การ restart และ exit code แยกราย container (`kubectl logs <pod> -c <container>`) และ `502` หรือ `503` ที่เห็นอาจมาจาก proxy ไม่ใช่จากแอปพลิเคชัน
- **Readiness ใช้ร่วมกัน** pod อาจรันอยู่แต่ยังไม่ ready เพราะ readiness probe ของ sidecar fail และแอปพลิเคชันอาจ healthy แต่เข้าไม่ถึง เพราะ proxy ของมัน crash และกำลังถูก restart
- **มองอาการเป็นปัญหาเรื่องลำดับก่อน** connection ที่โดนปฏิเสธในไม่กี่วินาทีแรกแปลว่าแอปพลิเคชัน start ก่อนตัวช่วย ส่วน error ในไม่กี่วินาทีสุดท้ายแปลว่าตัวช่วยหยุดก่อน และ Job ที่ไม่มีวันเสร็จแปลว่ามีตัวช่วยที่ไม่ยอม exit
- **ส่องเข้าไปข้างใน** ephemeral debug container (`kubectl debug`, stable ตั้งแต่ Kubernetes v1.25) เข้าร่วม pod ที่รันอยู่และเล็งไปที่ process namespace ของ container ตัวหนึ่งได้ ถ้าตั้ง `shareProcessNamespace: true` ไว้ container จะเห็น process ของกันและกัน และเห็น file system ของกันและกันผ่าน `/proc` ด้วย มีประโยชน์ตอน debug และเป็นอีกเหตุผลที่ควรมอง pod เป็น trust boundary เดียว
- **บันทึก sidecar version** ไว้คู่กับ application version หลัง upgrade injector แล้ว pod ของ workload เดียวกันอาจรัน sidecar คนละ version กันจนกว่าจะ restart ครบทุกตัว

## ข้อควรรู้ตอนลงมือทำ

- **ประกาศเป็น native sidecar ใน Kubernetes** ตัว `restartPolicy` บน init container คือความต่างทั้งหมด:

  ```yaml
  spec:
    initContainers:
      - name: log-shipper
        image: registry.example/logship:3.1
        restartPolicy: Always          # makes this init container a sidecar
        startupProbe:                  # the application starts once this succeeds
          httpGet: { path: /ready, port: 2020 }
        resources:
          requests: { cpu: 100m, memory: 100M }
          limits: { cpu: 100m, memory: 100M }
        volumeMounts:
          - { name: logs, mountPath: /var/log/app, readOnly: true }
    containers:
      - name: orders
        image: registry.example/orders:4.2
        volumeMounts:
          - { name: logs, mountPath: /var/log/app }
    volumes:
      - name: logs
        emptyDir: {}
  ```

- **กำหนดว่า "start แล้ว" แปลว่าอะไรด้วย startup probe** ถ้าไม่มี probe นี้ ตัว sidecar จะถือว่า start แล้วตั้งแต่ตอนที่ process ของมันรัน แต่ตอนนั้นยังเร็วกว่าตอนที่มันพร้อมให้บริการจริง
- **ตั้งงบเวลา shutdown** grace period (30 วินาทีโดย default) ครอบคลุมแอปพลิเคชันก่อนแล้วค่อยเป็น sidecar แอปพลิเคชันที่ใช้เวลาไปจนหมดจะไม่เหลือเวลาให้ sidecar flush เลย
- **ทำ interface ให้ไม่ผูกกับภาษา:** HTTP หรือ gRPC บน `localhost` ไฟล์บน shared volume หรือ Unix socket บน shared volume
- **Injection** platform มักเพิ่ม sidecar ด้วย mutating admission webhook ที่เปิดด้วย label หรือ annotation ทีมแอปพลิเคชันเลยไม่ต้องดูแลมันใน manifest ของตัวเอง ส่วน pod ที่มีอยู่แล้วจะไม่ถูกเปลี่ยน: sidecar จะโผล่ และ version ใหม่จะมาถึง ก็ตอนที่ pod ถูกสร้างใหม่ (เช่นด้วย `kubectl rollout restart`) ถ้าเครื่องมือหรือ webhook รุ่นเก่าใน admission chain ทิ้ง field ที่มันไม่รู้จัก ตัว native sidecar ก็จะเสีย `restartPolicy` ไปและบล็อกการ startup ของ pod
- **อัปเดตแบบ in-place** Kubernetes ยอมให้เปลี่ยน image ของ container ใน pod ที่รันอยู่ได้ และ restart แค่ container นั้น แต่ controller อย่าง Deployment ก็ยังสร้าง pod ใหม่มาแทนเมื่อ template เปลี่ยน ส่วน SidecarSet ของ OpenKruise ใช้ทาง in-place นี้ในการ upgrade sidecar image โดยไม่ต้องสร้าง pod ใหม่
- **ระวังการชนกัน** sidecar ที่ inject เข้ามาจะยึด port และบางทีก็ยึด user ID ใน pod ด้วย อย่างเช่น proxy ของ Istio รันเป็น UID 1337 แอปพลิเคชันเลยห้ามใช้ UID นี้

**ตัวอย่าง ตรวจสอบเมื่อตุลาคม 2026:**

- **service mesh proxy** Istio inject Envoy เป็น container `istio-proxy` เข้าไปใน pod ของ namespace ที่ติด label `istio-injection=enabled` ส่วน Linkerd inject `linkerd-proxy` ที่เขียนด้วย Rust เข้าไปใน workload ที่ติด annotation `linkerd.io/inject: enabled` ทั้งคู่ใช้ native sidecar container โดย default: Istio ตั้งแต่ 1.27 และ Linkerd ตั้งแต่ 2.20 สิ่งที่ proxy แบบนี้จำนวนมากทำร่วมกันภายใต้ control plane คือเรื่องของ [Service Mesh](../service-mesh/)
- **OpenTelemetry Collector แบบ sidecar** OpenTelemetry Operator inject Collector เข้าไปใน pod ที่ติด annotation `sidecar.opentelemetry.io/inject` จาก resource `OpenTelemetryCollector` ที่ตั้ง `mode` เป็น `sidecar` ส่วน Collector ตัวเดียวกันนี้ยังรันแบบหนึ่งตัวต่อ node (`daemonset`) หรือเป็น gateway ที่ใช้ร่วมกันก็ได้ โดย [Telemetry Pipeline](../telemetry-pipeline/) อธิบายว่าเมื่อไรควรใช้แบบไหน
- **injector ของ secrets agent** Vault Agent Injector ของ HashiCorp เป็น mutating webhook ที่ตอบสนองต่อ annotation `vault.hashicorp.com/agent-inject: "true"` มันเพิ่ม init container ที่ดึง secret มาก่อนแอปพลิเคชัน start และเพิ่ม sidecar ที่คอย authenticate และ render secret ต่อไปเรื่อย ๆ ลงใน volume แบบ in-memory ที่ mount ไว้ที่ `/vault/secrets` แอปพลิเคชันแค่อ่านไฟล์และไม่รู้อะไรเกี่ยวกับ Vault เลย ทางเลือกแบบราย node คือ Secrets Store CSI Driver ที่เป็น DaemonSet ที่ mount secret จาก store ภายนอกเป็น volume
- **application runtime ที่ทำงานผ่าน sidecar** Dapr (project ระดับ graduated ของ CNCF) รัน process `daprd` ข้าง ๆ แต่ละแอปพลิเคชัน โดย inject เข้าไปใน pod ที่ติด annotation `dapr.io/enabled: "true"` แอปพลิเคชันเรียกมันบน `localhost` ผ่าน HTTP (port 3500 โดย default) หรือ gRPC (50001) เพื่อใช้ state management, publish และ subscribe, service invocation, secret และ workflow โดย default มันถูก inject เป็น container ธรรมดา และเป็น native sidecar ได้ถ้าขอ (`dapr.io/enable-native-sidecar: "true"`)
