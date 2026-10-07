## ปัญหา

การส่ง order ของ Acme Shop แตะห้าระบบ: Lambda function ตรวจ order, DynamoDB เก็บสต็อก, ผู้ให้บริการ payment ตัดบัตร, SNS ส่งคำยืนยันออกไป และ container task จองบริษัทขนส่ง ส่วน order ใหญ่ ๆ ยังต้องมีคนอนุมัติด้วย วิธีที่คิดออกก่อนคือเชื่อมทั้งหมดด้วย glue code: Lambda function แต่ละตัวเรียกตัวถัดไป หรือวาง message ลง queue ถัดไป แต่แบบนี้ process จะมีอยู่แค่ในรูปของ call ที่ต่อกันเป็นทอด ๆ กระจายอยู่ในหลาย code base แต่ละ function ต้องมี retry และ timeout ของตัวเอง การรออนุมัติต้องถูกเก็บไว้ที่ไหนสักแห่งเป็นวัน ๆ ไม่มีใครเห็นว่า order o-982 หยุดอยู่ตรงไหน และถ้าพังกลางทาง สต็อกก็จะถูกจองค้างไว้ให้ order ที่ไม่มีวันได้จ่ายเงิน

AWS Step Functions คือ workflow service แบบ managed ของ AWS เราเขียน process ไว้ครั้งเดียวเป็น state machine ใน Amazon States Language (ASL) ที่เป็น format แบบ JSON แล้ว Step Functions ก็รันทุก execution ของมันให้: เรียก service, ส่งข้อมูลจาก step หนึ่งไปอีก step, ทำ retry และ catch error ตามที่ definition บอก, รอนานเท่าที่ต้องรอ และบันทึกทุก step ไว้ ส่วน function ก็กลับไปทำงานอย่างเดียวของตัวเองเหมือนเดิม

## ทำงานยังไง

### State และ execution

- state machine คือ JSON document หนึ่งตัว โดย `StartAt` บอกชื่อ state แรก และ `States` เก็บ state ทั้งหมดตามชื่อ แต่ละ state มี `Type` และส่วนใหญ่มี `Next` ด้วย ตัว definition ใหญ่ได้ถึง 1 MB และ Workflow Studio ใน console ก็วาดและแก้มันเป็น graph ได้
- **Task** คือตัวทำงาน: มันเรียก AWS service, HTTPS API หรือ activity worker ส่วน **Choice** แยก branch ตามข้อมูล **Parallel** รันชุด branch ที่กำหนดไว้พร้อมกันแล้วไปต่อเมื่อทุก branch เสร็จ **Map** รัน step ชุดเดียวกันกับทุก item ใน list **Wait** หยุดรอเป็นจำนวนวินาทีหรือจนถึง timestamp ที่กำหนด **Pass** ส่งต่อหรือปรับรูปข้อมูลโดยไม่ได้ทำงานอะไร และ **Succeed** กับ **Fail** ก็จบ execution
- **Map** มีสองโหมด โหมด *Inline* รันได้ถึง 40 iteration พร้อมกันภายใน execution แม่ และ event ของมันก็ลงใน history ของ execution แม่ ส่วนโหมด *Distributed* รันแต่ละ item หรือแต่ละ batch ของ item เป็น child execution ที่มี history ของตัวเอง ได้ถึง 10,000 ตัวขนานกัน และอ่าน item ได้ตรงจาก Amazon S3 (เช่น CSV, JSON Lines, Parquet และ Athena manifest)
- **execution** คือการรันหนึ่งครั้งด้วย JSON input หนึ่งชุด Acme ตั้งชื่อแต่ละ execution ตาม order ของมัน (`o-981`) ถ้าเป็น Standard state machine แล้วเรียก `StartExecution` ด้วยชื่อและ input เดียวกับ execution ที่กำลังรันอยู่ มันจะคืน response เดิมแทนที่จะเริ่มตัวที่สอง แต่ถ้า input ต่างไปหรือ execution ปิดไปแล้ว ก็จะได้ `ExecutionAlreadyExists` และชื่อนั้นจะใช้ซ้ำได้อีกหลัง execution ปิดไป 90 วัน
- state machine ทุกตัวเป็นได้แบบเดียว คือ **Standard** หรือ **Express** (ดูด้านล่าง) และเปลี่ยนประเภททีหลังไม่ได้

### การเรียก service

Task state บอกสิ่งที่มันเรียกไว้ใน `Resource`:

- **Optimized integration** (ประมาณยี่สิบ service เช่น Lambda, DynamoDB, ECS และ Fargate, SNS, SQS, EventBridge, AWS Batch, AWS Glue, Athena, SageMaker AI และ Amazon Bedrock) มี resource อย่าง `arn:aws:states:::dynamodb:updateItem` พร้อมการจัดการเพิ่ม: ผลลัพธ์ JSON ของ Lambda จะถูก parse ให้ และถ้าใช้ `.sync` ตัว ECS `RunTask` ที่รายงานว่าพังก็จะทำให้ task พังด้วย ส่วน DynamoDB integration รองรับ `GetItem`, `PutItem`, `UpdateItem` และ `DeleteItem` แบบนี้เองที่ ReserveStock และ ReleaseStock แก้ table Stock ได้โดยไม่มี function คั่นกลาง
- **AWS SDK integration** (`arn:aws:states:::aws-sdk:service:action`) เรียก API ได้แทบทุกตัวของ AWS service กว่า 200 ตัว ด้วย parameter ของ SDK เอง ในเดือนมีนาคม 2026 AWS เพิ่มอีก 28 service เช่น Amazon Bedrock AgentCore และ S3 Vectors
- **HTTP Task** (`arn:aws:states:::http:invoke`) เรียก HTTPS API ที่อยู่นอก AWS มันเอา credential มาจาก EventBridge connection และต้องได้คำตอบภายใน 60 วินาที ส่วน Acme เลือกเก็บ call ไปหา payment ไว้ใน function charge-card แทน เพราะ SDK ของผู้ให้บริการและ error code ของมันอยู่ที่นั่น
- **Activity** คือ worker ของเราเองที่ poll Step Functions ด้วย `GetActivityTask` แล้วรายงานผลกลับไป

แต่ละ call ใช้ integration pattern หนึ่งในสามแบบ:

| Pattern | Resource ลงท้ายด้วย | Step Functions ไปต่อเมื่อ | ใช้ใน PlaceOrder |
|---|---|---|---|
| Request Response | ไม่มีอะไร (ค่าตั้งต้น) | ทันทีที่ service ตอบ call | ValidateOrder, ReserveStock, ChargeCard, SendConfirmation |
| Run a Job | `.sync` | เมื่อ job เสร็จแล้ว: ECS task หยุดแล้ว หรือ Batch หรือ Glue job จบแล้ว | ArrangeShipping (`ecs:runTask.sync`) |
| Wait for Callback | `.waitForTaskToken` | เมื่อมีคนเรียก `SendTaskSuccess` หรือ `SendTaskFailure` พร้อม task token | WaitForApproval (`sqs:sendMessage.waitForTaskToken`) |

สำหรับ call แบบ `.sync` ใน account เดียวกัน Step Functions จะตามดู job ผ่าน EventBridge event และการ poll ส่วนถ้า task แบบนี้ถูกทิ้งกลางทาง (execution ถูกหยุด หรือ branch อื่นใน Parallel state เดียวกันพัง) Step Functions จะพยายามหยุด job ให้ แต่ทำแค่แบบ best-effort

นี่คือ ReserveStock และ ChargeCard ตามที่ PlaceOrder นิยามไว้ ด้วย JSONata (ดูหัวข้อถัดไป):

```json
{
  "ReserveStock": {
    "Type": "Task",
    "Resource": "arn:aws:states:::dynamodb:updateItem",
    "Arguments": {
      "TableName": "Stock",
      "Key": { "sku": { "S": "{% $states.input.sku %}" } },
      "UpdateExpression": "SET available = available - :qty",
      "ConditionExpression": "available >= :qty",
      "ExpressionAttributeValues": { ":qty": { "N": "{% $string($states.input.qty) %}" } }
    },
    "Output": "{% $states.input %}",
    "Next": "ChargeCard"
  },
  "ChargeCard": {
    "Type": "Task",
    "Resource": "arn:aws:states:::lambda:invoke",
    "Arguments": { "FunctionName": "charge-card", "Payload": "{% $states.input %}" },
    "Assign": { "chargeId": "{% $states.result.Payload.chargeId %}" },
    "Output": "{% $states.input %}",
    "TimeoutSeconds": 30,
    "Retry": [ {
      "ErrorEquals": [ "Payment.Timeout" ],
      "IntervalSeconds": 2, "BackoffRate": 2, "MaxAttempts": 2
    } ],
    "Catch": [ {
      "ErrorEquals": [ "States.ALL" ],
      "Output": "{% $merge([$states.input, { 'error': $states.errorOutput }]) %}",
      "Next": "ReleaseStock"
    } ],
    "Next": "NeedsApproval"
  }
}
```

ถ้าสต็อกไม่พอ condition จะทำให้ `UpdateItem` พังด้วย `DynamoDB.ConditionalCheckFailedException` แล้ว Catch บน ReserveStock ก็ส่งต่อไปทางของกรณีสินค้าหมดได้ ส่วน Choice state ที่ตามหลัง ChargeCard มีแค่ rule เดียว: `"Condition": "{% $states.input.total > 50000 %}"` ไปที่ WaitForApproval และที่เหลือทั้งหมดไปที่ `Default` ของมัน คือ Fulfil

### ข้อมูลระหว่าง state

- output ของแต่ละ state จะกลายเป็น input ของ state ถัดไป และ input หรือ output แต่ละตัวใหญ่ได้ไม่เกิน **256 KiB** (ณ ตุลาคม 2026) ข้อมูลที่ใหญ่กว่านั้นต้องไปอยู่ใน S3 แล้วส่งต่อกันเป็น key ตาม pattern [Claim Check](../claim-check/) ส่วนผลลัพธ์ที่ใหญ่เกินจะทำให้ state พังด้วย `States.DataLimitExceeded`
- field `QueryLanguage` เลือกว่า state จะเลือกและปรับรูปข้อมูลยังไง ตั้งได้ทั้ง state machine หรือทีละ state แล้วถ้าใช้ **JSONata** ตัว state จะมีสอง field คือ `Arguments` (สิ่งที่จะส่ง) และ `Output` (สิ่งที่จะส่งต่อ) ค่าของมันใส่ expression ใน `{% %}` ได้ โดยอ้างถึง `$states.input`, `$states.result`, `$states.errorOutput` (ใน Catch) และ `$states.context` (ชื่อ execution, เวลาเริ่ม และ task token) ส่วน **JSONPath** ใช้ห้า field แทน (`InputPath`, `Parameters`, `ResultSelector`, `ResultPath`, `OutputPath`) ส่วนถ้าไม่ได้ใส่ field ที่เลือกภาษาไว้ ค่าตั้งต้นก็ยังเป็น JSONPath แต่ตั้งแต่ JSONata มาในเดือนพฤศจิกายน 2024 AWS ก็แนะนำให้ใช้ JSONata กับ workflow ใหม่ และ PlaceOrder ก็ใช้มันทั้งหมด
- **Variable** (มาในเดือนพฤศจิกายน 2024 เหมือนกัน) เก็บค่าไว้ให้ state ไหนก็ได้ที่มาทีหลัง ไม่ใช่แค่ state ถัดไป ตัว `Assign` ของ ChargeCard เก็บ `chargeId` จากผลลัพธ์ของ Lambda แล้ว SendConfirmation ก็อ่าน `$chargeId` ได้ในอีกสาม state ต่อมา ในขณะที่ตัว order เองไหลต่อไปโดยไม่ถูกแก้ ตัว variable อยู่ใน scope ของ state machine ของมัน: branch ของ Parallel และ iteration ของ Map อ่าน variable ข้างนอกได้แต่มี variable ของตัวเองแยกไว้ ส่วน Distributed Map อ่าน variable ข้างนอกไม่ได้ ส่วนขนาด variable หนึ่งตัวและ `Assign` หนึ่งตัวเก็บได้ถึง 256 KiB และ variable ทั้งหมดของ execution หนึ่งรวมกันได้ถึง 10 MiB

### Error, retry และ timeout

- error มีชื่อ ชนิดของ exception จาก Lambda function จะกลายเป็นชื่อ error (charge-card throw `Payment.Timeout`) ส่วน error ของ service จะมี prefix อย่าง `Lambda.ServiceException` หรือ `DynamoDB.ConditionalCheckFailedException` แล้ว Step Functions ก็มี error ของตัวเอง: `States.Timeout`, `States.HeartbeatTimeout`, `States.TaskFailed`, `States.DataLimitExceeded` และ wildcard `States.ALL`
- **Retry** (บน Task, Parallel และ Map state) match error ตามชื่อแล้วลองใหม่: รอ `IntervalSeconds` ก่อน retry ครั้งแรก (ค่าตั้งต้น 1) คูณด้วย `BackoffRate` (ค่าตั้งต้น 2) ทุกครั้ง และ retry ทั้งหมด `MaxAttempts` ครั้ง (ค่าตั้งต้น 3 ส่วน 0 แปลว่าไม่ retry เลย) ตัว `MaxDelaySeconds` กำหนดเพดานของเวลารอ และ `JitterStrategy` `FULL` สุ่มเวลารอ ทำให้ retry จาก execution จำนวนมากกระจายออกไป นี่คือ [Retry with Backoff](../retry-with-backoff/) แบบไม่ต้องเขียนเอง ส่วน `MaxAttempts` 2 ของ ChargeCard แปลว่าลองทั้งหมดสามครั้ง โดยรอ 2 s และ 4 s ตามที่เห็นใน step 3
- **Catch** มารับช่วงต่อเมื่อ retry หมดแล้ว: มันส่ง execution ไปที่ fallback state พร้อม error output ที่เป็น object มี `Error` และ `Cause` ส่วนใน PlaceOrder ตัว state นั้นคือ ReleaseStock ที่เป็น [compensating transaction](../compensating-transaction/) ของ ReserveStock แล้วตามด้วย Fail state OrderFailed ที่ `Error` และ `Cause` ของมันจะกลายเป็นความล้มเหลวของ execution ส่วน `States.ALL` ไม่ได้ catch `States.DataLimitExceeded` หรือ `States.Runtime` เลยต้องใส่ชื่อมันไว้ตรง ๆ ในจุดที่มันสำคัญ
- **Timeout** โดยค่าตั้งต้น Task รอได้ถึง 99,999,999 วินาที เพราะฉะนั้นให้ตั้ง `TimeoutSeconds` บนทุก Task ไม่อย่างนั้น callback ที่หายไปจะทำให้ execution รอค้างอยู่หนึ่งปี worker ที่รันนานเรียก `SendTaskHeartbeat` ได้ แล้ว `HeartbeatSeconds` ก็จะทำให้ task พังด้วย `States.Timeout` เมื่อ heartbeat หยุดมา
- ใน **Parallel** state ถ้า branch ไหนพังโดยไม่มีใคร catch ทั้ง state จะพังและ branch อื่นจะถูกหยุด แต่ Lambda function ที่รันอยู่แล้วก็ยังรันต่อไปจนจบ

### การรอคนและระบบอื่น

WaitForApproval ส่ง order พร้อม **task token** ไปที่ queue `approvals` แล้วหยุดรอ app หลังบ้านของ Acme อ่าน queue นี้ แสดง order ให้คนอนุมัติดู แล้วพอเขาตัดสินใจ app ก็เรียก `SendTaskSuccess` (หรือ `SendTaskFailure`) พร้อม token นั้น ตัว Standard execution รอแบบนี้ได้นานถึงหนึ่งปี และเพราะ Standard workflow คิดเงินตาม state transition ไม่ใช่ตามเวลา การรอเองก็เลยไม่ได้เพิ่มบิลเลย ตัว task มี `TimeoutSeconds` 3 วัน ที่ Catch เปลี่ยนให้เป็นการปฏิเสธอัตโนมัติได้ ส่วน token จะใช้ได้ก็ต่อเมื่อ principal ที่ส่งมันกลับมาอยู่ใน AWS account เดียวกัน และใช้ task token ใน Express workflow ไม่ได้

```json
{
  "WaitForApproval": {
    "Type": "Task",
    "Resource": "arn:aws:states:::sqs:sendMessage.waitForTaskToken",
    "Arguments": {
      "QueueUrl": "https://sqs.us-east-1.amazonaws.com/111122223333/approvals",
      "MessageBody": {
        "orderId": "{% $states.input.orderId %}",
        "total": "{% $states.input.total %}",
        "taskToken": "{% $states.context.Task.Token %}"
      }
    },
    "Output": "{% $states.input %}",
    "TimeoutSeconds": 259200,
    "Next": "Fulfil"
  }
}
```

```sh
# the Orders API starts an execution named after the order
aws stepfunctions start-execution \
  --state-machine-arn arn:aws:states:us-east-1:111122223333:stateMachine:PlaceOrder \
  --name o-983 \
  --input '{"orderId":"o-983","sku":"LT-900","qty":1,"total":68400}'

# later, the back-office app reports the approver's decision with the token from the message
aws stepfunctions send-task-success \
  --task-token "$TASK_TOKEN" \
  --task-output '{"approved":true}'
```

### Standard และ Express

| | Standard | Express |
|---|---|---|
| execution ที่นานที่สุด | 1 ปี | 5 นาที |
| Execution semantics | exactly once: state จะรันซ้ำก็ต่อเมื่อ Retry สั่งเท่านั้น | แบบ asynchronous: at least once ส่วนแบบ synchronous (`StartSyncExecution`): at most once |
| Execution history | Step Functions เก็บไว้ 90 วัน (30 วันถ้าขอ) ได้ถึง 25,000 event และอ่านได้ด้วย `GetExecutionHistory` | ไม่เก็บ มีแค่สิ่งที่เราส่งไป [CloudWatch](../amazon-cloudwatch/) Logs ที่ส่งแบบ best-effort |
| Integration pattern | Request Response, `.sync`, `.waitForTaskToken`, activity, Distributed Map | Request Response เท่านั้น |
| Start rate (ค่าตั้งต้น) | `StartExecution`: burst ได้ 1,300 แล้วตามด้วย 300 ต่อวินาทีใน N. Virginia, Oregon และ Ireland (ที่อื่น 800 และ 150) | 6,000 ต่อวินาที |
| State transition | 5,000 ต่อวินาทีในสาม Region นั้น ที่อื่น 800 (ขอเพิ่มได้) | ไม่จำกัด |
| Redrive | ได้ ภายใน 14 วัน | ไม่ได้ (แต่ Express child ของ Distributed Map redrive ได้) |
| ราคา (US East, ตุลาคม 2026) | $0.025 ต่อ 1,000 state transition | $1.00 ต่อล้าน request บวกค่า duration ตาม memory |

rate ทั้งหมดข้างบนคิดต่อ account และ Region และ account ใหม่จะเริ่มด้วย quota ของ state transition ที่ต่ำกว่านี้ Standard เหมาะกับตัว order เอง: งานยาว ตรวจสอบย้อนหลังได้ และเต็มไปด้วย step ที่ห้ามรันซ้ำ เช่นการตัดบัตร ส่วน Express เหมาะกับงานสั้นปริมาณมาก เช่น process event หรือข้อมูล IoT ที่ทุก step idempotent สองแบบนี้ใช้ร่วมกันได้: AWS แนะนำให้เก็บ step ที่ไม่ idempotent ไว้ใน Standard ตัวแม่ แล้วซ้อน Express workflow ไว้ข้างในสำหรับ step ที่ idempotent และมาเป็น burst

### Redrive, version และ alias

- **Redrive** (`RedriveExecution`, พฤศจิกายน 2023) เริ่ม Standard execution ที่พัง ถูก abort หรือ timeout ใหม่ได้ภายใน 14 วันหลังมันจบ มันทำต่อจาก step ที่ไม่สำเร็จ ด้วย input เดิมและ definition เดิม และไม่ทำ step ที่สำเร็จไปแล้วซ้ำ ใน Parallel state จะรันใหม่แค่ branch ที่พัง และตัวนับ retry ก็เริ่มนับใหม่ ถ้า ArrangeShipping พังโดยไม่มี Catch การ redrive หลังแก้เสร็จจะจองบริษัทขนส่งได้โดยไม่ตัดบัตรซ้ำ ส่วน execution ที่ชดเชยไปแล้วและจบที่ Fail state อย่าง o-982 ควรเริ่มใหม่ตั้งแต่ต้นเมื่อผู้ให้บริการกลับมาใช้ได้
- **Version** คือ snapshot ของ state machine ที่มีเลขกำกับและแก้ไม่ได้ (ได้ถึง 1,000 ตัว) ส่วน **alias** อย่าง `PROD` ชี้ไปที่ version เดียว หรือแบ่ง execution ใหม่ระหว่างสอง version ตามน้ำหนัก (ได้ถึง 100 alias) การเริ่ม execution ผ่าน alias ทำให้ version ใหม่รับ order ไป 10% ก่อนได้ แบบ [canary release](../canary-release/) และทุก execution รวมถึงตัวที่ redrive ก็จะอยู่บน version ที่มันเริ่มต้นไปตลอด

### การทดสอบ

API `TestState` รัน state ตัวเดียว จะส่งมาเดี่ยว ๆ หรือเลือกออกมาจาก definition ทั้งก้อนด้วย `stateName` ก็ได้ โดยไม่ต้อง deploy อะไร แล้วรายงาน output, state ถัดไป และถ้าใช้ระดับ `DEBUG` ก็จะบอกทุกขั้นของการ process ข้อมูลด้วย ตั้งแต่เดือนพฤศจิกายน 2025 มันรับ **mock** ของผลลัพธ์หรือ error ของ service ได้ ทำให้ test ไม่ต้องใช้ทั้ง service จริงและ IAM role และยังทดสอบ Map, Parallel, `.sync` และ callback state รวมถึง retry ครั้งที่เลือกไว้ได้ด้วย ส่วน Step Functions Local ที่เป็น emulator ให้ดาวน์โหลดไปใช้ ก็ไม่ได้รับการ support แล้ว

```sh
# with both retries used up, a timeout from the provider should go to the Catch
aws stepfunctions test-state \
  --definition file://place-order.asl.json --state-name ChargeCard \
  --input '{"orderId":"o-982","sku":"MS-310","qty":1,"total":420}' \
  --mock '{"errorOutput": {"error": "Payment.Timeout", "cause": "no answer from the provider"}}' \
  --state-configuration '{"retrierRetryCount": 2}'
# expected: "status": "CAUGHT_ERROR", "nextState": "ReleaseStock"
```

### การดู execution

- **execution history** ของ Standard execution แสดงทุก event: แต่ละ state ที่เข้าและออกพร้อม input, output และ variable ที่มัน assign รวมถึงแต่ละ task ที่ถูก schedule, เริ่ม, สำเร็จ หรือพัง ตัว console วาดมันลงบน graph ทำให้ทีม support เปิด o-982 ขึ้นมาแล้วเห็นได้ว่ามันพังตรงไหนและเพราะอะไร
- **CloudWatch Logs** รับ history ตามระดับที่เลือก (`ALL`, `ERROR`, `FATAL` หรือ `OFF`) จะมีข้อมูลด้วยหรือไม่ก็ได้ (`includeExecutionData`) และ Express workflow ไม่มีบันทึกที่อื่นนอกจากนี้ ส่วน **CloudWatch metrics** นับ execution ที่เริ่ม สำเร็จ พัง timeout และโดน throttle รวมถึง execution ที่เปิดอยู่เทียบกับ limit ของ account และตั้งแต่เดือนตุลาคม 2025 console ก็แสดงมันพร้อมตัวเลขค่าใช้จ่ายบน metrics dashboard
- **AWS X-Ray** trace execution ไปพร้อมกับ Lambda function และ service ที่มันเรียก ส่วน Standard workflow ส่ง **EventBridge** event ทุกครั้งที่ status เปลี่ยน ทีมก็ route event นี้ไปที่ alarm หรือไปหา client ที่รออยู่ได้

### Pricing

ณ ตุลาคม 2026 ใน US East (N. Virginia):

- **Standard:** $0.025 ต่อ 1,000 state transition หลังจาก free tier 4,000 ต่อเดือนที่ไม่มีวันหมดอายุ ทุก state ที่รันนับหมด รวมถึงทุก retry และทุก redrive ด้วย แบบนี้ workflow ที่ใช้สิบ transition ต่อ order จะเสียประมาณ $25 สำหรับ 100,000 order ต่อเดือน
- **Express:** $1.00 ต่อล้าน execution บวกค่า duration ที่ $0.00001667 ต่อ GB-second สำหรับ 1,000 GB-hour แรกของเดือน ปัดขึ้นเป็น 100 ms และคิดตาม memory เป็นขั้นละ 64 MB โดย memory ขึ้นกับขนาดของ definition และข้อมูล ส่วน execution ยาว 30 วินาทีที่ 64 MB หนึ่งล้านครั้ง จะเป็นค่า duration ประมาณ $31
- ยังต้องบวกค่า service ที่ workflow เรียก (Lambda, DynamoDB, ECS) และ CloudWatch Logs เข้าไปอีก

## อยู่ตรงไหนใน solution

- **Solution:** workflow ของ order และ payment แบบ PlaceOrder, process อนุมัติและ process อื่นที่มีคนอยู่ใน loop, data และ ETL pipeline ที่รัน Distributed Map บน S3 object เป็นล้านตัว, pipeline ของ machine learning และ media (SageMaker AI, MediaConvert), automation ด้าน IT และ security และ AI workflow ที่เรียก model ของ Amazon Bedrock หรือตั้งแต่เดือนมิถุนายน 2026 ก็เรียก agent ของ Bedrock AgentCore เป็น step หนึ่งได้ (managed harness ที่อยู่เบื้องหลังยังเป็น preview)
- **Pattern ที่มัน implement หรือช่วยรองรับ:** [Saga (Orchestration)](../saga-orchestration/) โดยมี Step Functions เป็น orchestrator และ Catch state คอยรันแต่ละ [Compensating Transaction](../compensating-transaction/) (step 1 และ 3), [Retry with Backoff](../retry-with-backoff/) และ [Timeout and Fallback](../timeout-and-fallback/) ในรูปของ Retry, `TimeoutSeconds` และ Catch, [Asynchronous Request-Reply](../asynchronous-request-reply/) เพราะ `StartExecution` ตอบกลับทันที แล้ว client ก็ poll `DescribeExecution` หรือรอฟัง event ตอน status เปลี่ยน, [Pipes and Filters](../pipes-and-filters/) ในรูปของ Task state ที่ต่อกันเป็นทอด ๆ โดยแต่ละตัวแปลงข้อมูล และ [Claim Check](../claim-check/) สำหรับอะไรก็ตามที่เกิน 256 KiB ส่วน step ของ Express workflow และ step ไหนก็ตามที่ Retry ทำซ้ำ ควร [idempotent](../idempotent-consumer/)
- **เพื่อนบ้านที่มักเจอ:** API Gateway หรือ Lambda function ที่เริ่ม execution, rule ของ [EventBridge](../amazon-eventbridge/) และ EventBridge Scheduler ที่เริ่ม execution ตาม schedule แบบ cron หรือ rate, service ที่มันเรียก เช่น [Lambda](../aws-lambda/), [DynamoDB](../amazon-dynamodb/), [SQS](../amazon-sqs/), [SNS](../amazon-sns/), [ECS และ Fargate](../amazon-ecs/), AWS Batch, AWS Glue และ [S3](../amazon-s3/), CloudWatch และ X-Ray และ execution role ของ [IAM](../aws-iam/) ที่ถือ permission ของ state machine
- **Managed offering:** Step Functions เองก็คือ managed service อยู่แล้ว ส่วนบริการที่ใกล้เคียงที่สุดในที่อื่นคือ Amazon MWAA ที่รัน Apache Airflow (version ถึง 3.3.1 ณ กันยายน 2026), Temporal Cloud สำหรับ Temporal และใน Lambda เองก็มี Lambda durable functions ส่วน cloud อื่นมี Azure Durable Functions และ Google Cloud Workflows

## ใช้ตอนไหนดี

ใช้ Step Functions เมื่อ business process ข้ามหลาย service และหลาย step, ต้องรอดได้ถ้าพังกลางทาง, อาจต้องรอเป็นนาทีไปจนถึงเป็นเดือน และมีคนต้องเห็นว่าแต่ละรอบไปถึงไหนแล้ว มันเหมาะที่สุดกับระบบที่ใช้ AWS เยอะ เพราะ AWS API ส่วนใหญ่อยู่ห่างไปแค่ Task state เดียว ให้มองหาตัวเลือกอื่นเมื่อ logic ของ workflow ซับซ้อนจนอยากได้ภาษาโปรแกรมจริง ๆ เมื่อระบบต้องรันนอก AWS ด้วย สำหรับ batch data pipeline ที่ตั้งเวลาไว้และทีม data ดูแลด้วย Python และสำหรับ loop ถี่ ๆ ของ step เล็ก ๆ ที่ทุก transition เสียทั้งเงินและพื้นที่ใน history

| | เขียน flow เป็น | เก็บความคืบหน้าไว้ที่ไหน | การรอนาน ๆ | เลือกใช้กับ |
|---|---|---|---|---|
| **AWS Step Functions** | JSON state machine (ASL) หรือ graph ใน Workflow Studio | service เก็บให้: history ของแต่ละ Standard execution ได้ 25,000 event | ได้ถึงหนึ่งปี (Standard) และมี task token สำหรับ callback | orchestrate AWS service, การอนุมัติ, saga, process ที่ต้อง audit ได้ |
| **Temporal** | โค้ดธรรมดา (Go, Java, Python, TypeScript, .NET และอื่น ๆ) ใช้ license MIT จะ self-host หรือใช้ Temporal Cloud ก็ได้ | event history ที่ถูก replay กลับเข้าโค้ดของ workflow ได้ถึง 51,200 event หรือ 50 MB ต่อ execution | timer และ signal และ workflow รันได้เป็นปี | workflow ที่ซับซ้อน รันนาน และเน้นเขียนเป็นโค้ด บน cloud ไหนก็ได้ |
| **Apache Airflow** (Amazon MWAA) | Python DAG ใช้ Apache License 2.0 | metadata database ของการรัน DAG และ task | รันตามเวลาหรือตาม event ไม่ใช่ต่อ request | data pipeline ที่ตั้งเวลาไว้, ETL และการ train ML |
| **Lambda durable functions** | โค้ดใน Lambda function ตัวเดียว พร้อม durable execution SDK (JavaScript, TypeScript, Python, Java) | checkpoint ที่ถูก replay หลังหยุดพักหรือ crash | ได้ถึงหนึ่งปี และการรอไม่เสียค่า compute | workflow ที่ส่วนใหญ่เป็นโค้ด Lambda |
| **Lambda function ที่ต่อกันด้วย queue** | แต่ละ function ส่งงานไปที่ queue ถัดไป | ไม่มีที่ไหนเป็นพิเศษ: log และ table ของเราเอง | ได้แค่เท่าที่เราสร้างเอง | งานสองสาม step ที่ workflow service จะกลายเป็นภาระเกินจำเป็น |

## ได้อะไร เสียอะไร

- **process มองเห็นได้และทนทาน** ทุก Standard execution มี graph และ history ครบ และ platform ดูแล state, retry และการรอ ทำให้ function เล็กอยู่ได้ แต่แลกกับการที่ flow ไปอยู่ใน JSON definition แทนที่จะอยู่ในโค้ด ทำให้การ review, refactor และ type check ทำได้แย่กว่าโปรแกรม ส่วน CDK และเครื่องมือคล้าย ๆ กันก็ generate definition จากโค้ดได้
- **limit เป็นตัวกำหนดการออกแบบ** 256 KiB ต่อ input หรือ output, 25,000 event ต่อ Standard history (Inline Map ที่วนบน item หลักพันตัวก็ชนแล้ว), 5 นาทีต่อ Express execution และ definition 1 MB ทำให้ข้อมูลใหญ่ต้องส่งแบบ reference ส่วน loop ยาว ๆ ต้องย้ายไปใช้ Distributed Map หรือ execution ตัวใหม่
- **ค่าใช้จ่ายตามจำนวน step** Standard คิดเงินต่อ transition รวม retry ด้วย เลยถูกเมื่อเป็น order สิบ step แต่แพงเมื่อเป็น workflow ที่วน loop บน step เล็ก ๆ จำนวนมาก ตรงนั้น Express ถูกกว่า แต่ต้องยอมเสีย history, `.sync`, task token และ exactly-once semantics
- **throughput มี quota** rate ของการเริ่มและ transition โดน throttle ต่อ account และ Region ด้วย soft limit และ Standard ให้มี execution ที่เปิดอยู่ได้ล้านตัวต่อ Region ถ้า burst ใหญ่มาก ๆ ต้องใช้ Express, batching หรือขอเพิ่ม quota
- **exactly once มีขอบเขต** มันครอบคลุมแค่ transition ของ Step Functions เอง ตัว Retry ตั้งใจเรียกซ้ำ ส่วน Lambda function หรือ ECS task ที่ถูก abort ก็อาจยังรันจนจบ และ Express execution แบบ asynchronous ก็อาจรันสองครั้ง เพราะฉะนั้น step ที่แก้ข้อมูลต้องรับมือกับการทำซ้ำได้
- **ใช้ได้แค่บน AWS** service นี้รันแค่ใน AWS และ integration ของมันก็เรียก AWS API ส่วน spec ของ ASL เปิดเป็นสาธารณะก็จริง แต่ถ้าจะย้ายออกจาก AWS ก็ยังต้องเขียน workflow ใหม่หรือหาที่ host ใหม่ ในขณะที่ Temporal และ Airflow รันได้ทุกที่

## ข้อควรรู้ตอนลงมือทำ

- **ตั้ง timeout ทุกที่:** `TimeoutSeconds` บนทุก Task (ค่าตั้งต้นคือ 99,999,999 วินาที), timeout ของทั้ง state machine ถ้าเหมาะ และ `HeartbeatSeconds` สำหรับ worker ที่รันนาน
- **retry ให้ถูก error:** ใส่ Lambda service error ที่ AWS แนะนำให้ retry (`Lambda.ServiceException`, `Lambda.AWSLambdaException`, `Lambda.SdkClientException`, `Lambda.ClientExecutionTimeoutException`) ใช้ backoff กับ `MaxDelaySeconds` และ `JitterStrategy` และเก็บ `States.ALL` ไว้ให้ catcher ตัวสุดท้าย
- **ชดเชยให้ชัด:** ให้ทุก step ที่เปลี่ยนอะไรสักอย่างมี state สำหรับ undo แล้ว route Catch ไปที่ตัวนั้น และจบที่ Fail state ที่มี `Error` และ `Cause` ที่ทีม support เอาไปทำอะไรต่อได้ แต่อย่าใส่ secret และรายละเอียดภายในลงใน `Cause`
- **ตั้งชื่อ execution ตาม business key** เช่น order ID ทำให้ `StartExecution` ที่ถูก retry เริ่ม order เดิมสองครั้งไม่ได้ (ใน Standard workflow จนถึง 90 วันหลัง execution ปิด)
- **ส่ง reference ไม่ใช่ document:** ใช้ S3 key กับอะไรก็ตามที่อาจโตเกิน 256 KiB และใช้ variable แทนการแบกทุกผลลัพธ์ไว้ใน payload
- **ดูขนาด history:** ใช้ Distributed Map กับ list ใหญ่ ๆ หรือเริ่ม execution ใหม่เพื่อทำ loop ที่รันนานต่อ ก่อนที่มันจะถึง 25,000 event
- **deploy ด้วย version และ alias** นิยาม state machine เป็นโค้ด (CloudFormation, SAM, CDK หรือ Terraform โดยที่ console export template ของ CloudFormation และ SAM ได้) และทดสอบแต่ละ state ด้วย `TestState` และ mock ก่อน deploy
- **ให้ execution role แค่สิ่งที่มันเรียก** เข้ารหัสด้วย customer managed KMS key ถ้า policy บังคับ และ log ที่ระดับ `ERROR` หรือไม่ใส่ execution data เมื่อ payload มีข้อมูลส่วนบุคคล
