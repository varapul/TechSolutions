## ปัญหา

ระบบ production ทุกตัวตั้งอยู่บนความเชื่อเรื่อง failure ที่ช่วงหลังไม่มีใครตรวจเลย *เรารันสาม instance เสียไปตัวหนึ่งก็ไม่เป็นไร load balancer จะรู้เอง Payments มี timeout เรา fail over ไปอีก region ได้* แต่ละข้อคือกลไกที่มีคนออกแบบไว้ และส่วนใหญ่จะได้ใช้จริงก็ตอนเกิด outage จริงเท่านั้น และนั่นเป็นจังหวะที่แย่ที่สุดที่จะมารู้ว่ามีตัวหนึ่งไม่เคยทำงานเลย

distributed system ทำให้เรื่องนี้แย่ลง service ทุกตัวอาจถูกต้องเมื่อดูทีละตัว แต่ตอนที่มันทำงานร่วมกันกลับไม่ถูก: dependency ที่ช้าตัวเดียวดึง thread ของผู้เรียกทุกตัวไว้ ส่วน retry ก็โหมโหลดเพิ่มลงไปบนตัวที่กำลังลำบากอยู่แล้ว health check รายงานว่า healthy ทั้งที่ request จริงทุกตัว fail ส่วน configuration ก็ค่อย ๆ เพี้ยนไป dependency เปลี่ยนเจ้าของ และ traffic ก็โตเกินขนาดที่แผน failover คิดไว้ staging environment แทบไม่เคยมี traffic, ข้อมูล หรือ configuration ที่จะเผยปัญหาพวกนี้ออกมา และ design review ก็บอกไม่ได้ว่า design จะทำตัวยังไงตอนที่มีอะไรข้างใต้พัง

[Principles of Chaos Engineering](https://principlesofchaos.org/) ระบุจุดอ่อนที่เรื่องนี้มักซ่อนไว้: fallback ที่ตั้งค่าผิด retry storm ที่เกิดจาก timeout ที่จูนไว้ไม่ดี downstream service ที่โดน traffic ถล่มเกินกว่าจะรับไหว และความล้มเหลวที่ลามต่อกันมาจากจุดเดียว ทั้งหมดนี้มองไม่เห็นจนกว่าจะถึงวันที่มันสำคัญ

## ทำงานยังไง

chaos engineering ตั้งใจหาจุดอ่อนพวกนั้นภายใต้การควบคุม ก่อนที่มันจะมาหาเรา หลักการนิยามมันว่าเป็นการทดลองกับระบบเพื่อสร้างความมั่นใจว่ามันทนต่อ "turbulent conditions in production" ได้ คำที่สำคัญคือ *การทดลอง*: มีความคาดหวังที่บอกไว้ชัด, fault เล็ก ๆ ที่ตั้งใจใส่, การวัด และข้อสรุป มันไม่ใช่การทำของพังเพื่อดูว่าจะเกิดอะไรขึ้น

### มาจากไหน

- **Chaos Monkey (2010)** ใน[โพสต์เดือนธันวาคม 2010](https://netflixtechblog.com/5-lessons-weve-learned-using-aws-1f2a28588e4c) เรื่องบทเรียนจากการรันบน AWS ทาง Netflix เล่าถึง Chaos Monkey คือ service ที่สุ่ม kill instance และ service ใน architecture ของตัวเอง เพื่อบังคับให้ engineer ต้องออกแบบรับ failure มันรันแค่ในเวลาทำงาน จะได้มีคนอยู่พร้อมตอนที่การ terminate เผยปัญหาออกมา
- **The Simian Army (2011)** [The Netflix Simian Army](https://netflixtechblog.com/the-netflix-simian-army-16e57fbab116) เพิ่ม failure แบบอื่น ๆ เข้ามา Latency Monkey ใส่ delay ปลอมระหว่าง client กับ service ตัว Chaos Gorilla จำลองการเสีย AWS Availability Zone ไปทั้ง zone และ monkey ตัวอื่น ๆ ก็คอยไล่หา resource ที่ตั้งค่าผิด ไม่ healthy ไม่ได้ใช้ หรือไม่ปลอดภัย ต่อมาการซ้อม Chaos Kong ก็จำลอง AWS region ล่มทั้ง region
- **จากเครื่องมือสู่ศาสตร์ (2014–2017)** failure injection testing (FIT) ของ Netflix ทำให้ request fail ได้เฉพาะกับ user ที่เลือกไว้ ในปี 2016 Basiri และทีมอธิบายแนวปฏิบัตินี้และหลักการของมันไว้ใน [*Chaos Engineering*](https://arxiv.org/abs/1702.05843) (IEEE Software) รวมถึงสัญญาณ steady state หลักของ Netflix คือ SPS: จำนวน video stream ที่เริ่มต่อวินาที ปีเดียวกันนั้น [Chaos Monkey 2.0](https://netflixtechblog.com/netflix-chaos-monkey-upgraded-1d679429be5d) ย้ายไปอยู่บน Spinnaker และเหลือไว้แค่การ terminate instance แล้วในปี 2017 [ChAP](https://netflixtechblog.com/chap-chaos-automation-platform-53e6d528371f) ก็ทำให้การทดลองกับ control group เป็นอัตโนมัติ
- **ปัจจุบัน** โปรเจกต์ [Simian Army](https://github.com/Netflix/SimianArmy) เลิกพัฒนาแล้ว ส่วน [Chaos Monkey](https://github.com/Netflix/chaosmonkey) ยังอยู่ในรูปเครื่องมือเดี่ยวที่ทำงานผ่าน Spinnaker เว็บหลักการอัปเดตครั้งล่าสุดในเดือนมีนาคม 2019 และตอนนี้ AWS กับ Azure ก็มีบริการ fault injection แบบ managed ให้ใช้แล้ว

### Loop ของการทดลอง

หลักการอธิบายไว้สี่ขั้น ส่วน diagram รันมันสองรอบ:

1. **กำหนด steady state** เลือก output ที่วัดได้และแสดงว่าระบบกำลังทำหน้าที่ของมันอยู่ โดยมองจากข้างนอก: request ที่สำเร็จ, order ต่อนาที, stream ที่เริ่มต่อวินาที สัญญาณภายในอย่าง CPU usage บอกว่าระบบรับมือยังไง แต่ไม่ได้บอกว่าลูกค้าได้รับบริการอยู่ไหม ใน diagram ตัว steady state คือ checkout สำเร็จ 99.9% ที่ราว 1,200 order ต่อนาที วัดที่ load balancer
2. **ตั้งสมมติฐาน** ว่า steady state จะยังเป็นอยู่ทั้งใน control group และ experimental group คือกลุ่มที่โดน fault
3. **ใส่ fault ที่เกิดขึ้นจริงในชีวิตจริง**: instance ที่ตาย, dependency ที่ช้าลง, zone ที่ดับไป
4. **พยายามพิสูจน์ว่าสมมติฐานผิด** ด้วยการเทียบ steady state ตอนมี fault กับตอนไม่มี หลักการวางกรอบไว้เป็น control group กับ experimental group และ ChAP ก็ทำแบบนั้นตรง ๆ: มันเปิด control cluster กับ experiment cluster ขึ้นมา route traffic ส่วนเล็ก ๆ ไปให้แต่ละตัว แล้วใส่ fault ลงไปแค่ตัวเดียว

ถ้า steady state แทบไม่ขยับ ความมั่นใจในระบบก็เพิ่มขึ้น ถ้ามันขยับ การทดลองก็ทำหน้าที่ของมันแล้ว: มันเจอจุดอ่อนตอนที่ความเสียหายยังเล็ก แก้มัน รันการทดลองเดิมอีกรอบ แล้วก็รันต่อไปเรื่อย ๆ

### เขียนสมมติฐานยังไง

สมมติฐานที่มีประโยชน์ต้องระบุ fault, metric, limit และกลไกที่คาดว่าจะปกป้องเราไว้:

> ถ้า **Checkout instance ตัวหนึ่งในสามตัวโดน terminate** ตอนที่ traffic ปกติ **อัตรา checkout สำเร็จจะยังสูงกว่า 99.5%** เพราะ **health check ของ load balancer จะ route เลี่ยงมัน และ auto scaling จะสร้างตัวใหม่มาแทน**

- **ทำให้พิสูจน์ว่าผิดได้** "ระบบยังไม่ล่ม" ไม่มีทางผิด แต่ "อัตราสำเร็จยังสูงกว่า 99.5% และ p99 latency ต่ำกว่า 800 ms" ผิดได้
- **ระบุกลไก** แล้วการทดลองที่ไม่ผ่านจะบอกได้ว่ากลไกไหนทำให้ผิดหวัง ส่วนการทดลองที่ผ่านก็บอกว่ากลไกไหนพึ่งได้
- **ตั้ง limit ไว้ก่อนรัน** โดยคิดถึง [SLO](../slo-error-budgets/) ไว้ด้วย ถ้าตัวเลขตกลงนิดหน่อยแบบที่ลูกค้าไม่สังเกต และยังอยู่ใน error budget ก็ถือว่าผ่าน
- **จดไว้ว่าคาดว่าจะเห็นอะไร** ใน log, trace และ alert ถ้ามี alert ที่ควรดังแต่ไม่ดัง ก็นับเป็นสิ่งที่เจอเหมือนกัน

AWS Well-Architected Reliability Pillar มี template คล้าย ๆ กันอยู่ใน [REL12-BP04 Test resiliency using chaos engineering](https://docs.aws.amazon.com/wellarchitected/latest/reliability-pillar/rel_testing_resiliency_failure_injection_resiliency.html) และแนะนำให้เลือก fault ตามว่ามันเกิดบ่อยแค่ไหนและจะเจ็บแค่ไหน โดยใช้ post-incident analysis ที่ผ่านมาเป็นแหล่งข้อมูล

### หลักการขั้นสูง

หลักการเพิ่มแนวปฏิบัติอีกห้าข้อที่อธิบายภาพในอุดมคติ:

| หลักการ | ในทางปฏิบัติ |
|---|---|
| Build a hypothesis around steady state behavior | วัด output อย่าง throughput, error rate และ latency percentile ไม่ใช่ของข้างใน |
| Vary real-world events | ใช้ fault ที่เกิดขึ้นจริง ทั้ง hardware และ software failure และเหตุการณ์ที่ไม่ใช่ failure อย่าง traffic พุ่ง จัดลำดับตามผลกระทบหรือความถี่ |
| Run experiments in production | มีแค่ traffic จริงที่วิ่งผ่านเส้นทางของ request จริง |
| Automate experiments to run continuously | การทดลองที่รันด้วยมือตามระบบที่เปลี่ยนทุกวันไม่ทัน |
| Minimize blast radius | ทำให้ความเสียหายที่การทดลองทำกับลูกค้าน้อยและสั้น |

production คือจุดที่แนวปฏิบัตินี้ตั้งใจจะไปให้ถึง ไม่ใช่จุดเริ่มต้น: ดู *ความปลอดภัย* ข้างล่าง

### ประเภทของ fault

| Fault | ใส่ด้วยอะไร ตัวอย่างเช่น | ปกติทดสอบอะไร |
|---|---|---|
| instance, container หรือ process ที่โดน terminate | AWS FIS `aws:ec2:terminate-instances` หรือ `aws:eks:pod-delete`, Chaos Monkey | health check, auto scaling, state ที่เก็บไว้นอก instance |
| Latency | `aws:ecs:task-network-latency`, `aws:lambda:invocation-add-delay` กับ invocation บางเปอร์เซ็นต์ | timeout, deadline, thread pool และ connection pool |
| Error | `aws:lambda:invocation-error`, `aws:fis:inject-api-internal-error` | retry, idempotency, circuit breaker |
| เสีย dependency | `aws:network:disrupt-connectivity`, การ blackhole port | fallback, degraded mode, cache |
| zone หรือ region | scenario *AZ Availability: Power Interruption* ของ FIS, *Compute Zone Down* ของ Azure Chaos Studio, Chaos Gorilla และ Chaos Kong ของ Netflix | สิ่งที่อ้างว่าเป็น multi-zone, failover, capacity ที่เหลืออยู่ |
| resource หมด | stress CPU, memory และ I/O, ทำให้ disk เต็ม (`AWSFIS-Run-Disk-Fill`) | limit, autoscaling, back-pressure, alerting |
| ปัญหา clock และ DNS | time fault และ DNS fault ของ Chaos Mesh, *DNS Outage* ของ Azure Chaos Studio | certificate กับ token หมดอายุ, cache, resolver fallback |

### ความปลอดภัย

- **Blast radius** เริ่มจาก fault ที่เล็กที่สุดที่ยังพิสูจน์ได้ว่าสมมติฐานผิด: instance เดียว, request ไม่กี่เปอร์เซ็นต์, cell เดียว ขยายก็ต่อเมื่อผ่านแล้วเท่านั้น จาก instance ไปเป็น zone แล้วไปเป็น region แต่ diagram ก็แสดงให้เห็นว่าแค่นี้ยังไม่พอ: fault แตะการเรียก Payments แค่ 5% แต่เพราะ Checkout ไม่มี timeout การรอเลยลามไปทุก request ตัว blast radius จำกัดตัว fault แต่ไม่ได้จำกัดผลที่ตามมา
- **Stop condition** ตัดสินไว้ก่อนรันว่าอะไรจะทำให้มันจบ ผูกไว้กับ metric ของ steady state และทำให้เป็นอัตโนมัติ ใน AWS Fault Injection Service ตัว [stop condition](https://docs.aws.amazon.com/fis/latest/userguide/stop-conditions.html) คือ CloudWatch alarm: พอ alarm ดัง การทดลองก็หยุด และการทดลองที่หยุดไปแล้วจะทำต่อไม่ได้ ChAP จบการทดลองเองอัตโนมัติเมื่อมันเกิน error budget ที่ตั้งไว้ล่วงหน้า ให้มีปุ่ม abort แบบ manual ไว้ด้วย
- **จังหวะเวลา** รันตอนที่คนที่ดูแลระบบอยู่ทำงานและเฝ้าดูอยู่ ไม่ใช่ช่วง peak ช่วง launch หรือช่วง change freeze นี่คือเหตุผลที่ Chaos Monkey ทำงานแค่ในเวลาทำงาน
- **บอกคนอื่น** engineer ที่ on-call, ทีม support และทีมที่พึ่งพาระบบอยู่ควรรู้ว่ามีการทดลองกำลังรัน และควร mark จุดเริ่มกับจุดจบไว้บน dashboard จะได้ไม่มีใครไป debug มันเหมือนเป็น incident ส่วน incident จริงมาก่อนเสมอ แล้วการทดลองก็ต้องหยุด
- **เริ่มนอก production** เอกสาร AWS FIS แนะนำอย่างหนักแน่นให้มีช่วงวางแผนและรันครั้งแรกใน pre-production environment ตัว pre-production เจอปัญหาหยาบ ๆ ได้ถูก ๆ ส่วน production ทดสอบ traffic และ configuration จริงเมื่อรู้แล้วว่าการทดลองปลอดภัย
- **ตั้งใจใช้ error budget** การทดลองใน production ต้องแลกกับ request ที่ fail ไปบ้าง ให้จ่ายจาก [error budget](../slo-error-budgets/): วางแผนการทดลองใหญ่ ๆ ตอนที่ budget ยังเหลือ และข้ามไปเมื่อใช้หมดแล้ว

### สิ่งที่ต้องมีก่อน

- **Observability มาก่อน** ต้องเห็น metric ของ steady state แบบเกือบ real time ทั้งเพื่อตัดสินผลการทดลองและเพื่อให้ stop condition ทำงาน และต้องมีรายละเอียดพอจะอธิบายความเบี่ยงเบนได้: latency แยกตาม dependency, [distributed trace](../distributed-tracing/) และ [centralized log](../centralized-logging/) การทดลองที่มองไม่เห็นก็แค่ outage
- **แก้จุดอ่อนที่รู้อยู่แล้วก่อน** ถ้าระบบมี database ตัวเดียวที่ไม่มี replica การทดลองที่ kill มันก็แค่ยืนยันสิ่งที่รู้อยู่แล้ว โดยให้ลูกค้าเป็นคนจ่าย ส่วน chaos engineering มีไว้หาสิ่งที่เรายังไม่รู้
- **พื้นฐานต้องพร้อม:** redundancy, health check, timeout, runbook และ on-call rotation ที่ตอบสนองได้

### Game day และการทดสอบ disaster recovery

game day คือการซ้อมที่ใหญ่กว่าและวางแผนไว้ ทีมจำลองสถานการณ์ failure เช่นเสีย zone หรือเสีย dependency สำคัญ แล้วซ้อมการรับมือทั้งหมด: การตรวจจับและ alert, runbook, การสื่อสาร และการกู้คืน การทดลองอัตโนมัติทดสอบซอฟต์แวร์อย่างต่อเนื่อง ส่วน game day ทดสอบคนและขั้นตอนไปพร้อมกัน ตัว Reliability Pillar แนะนำให้ [จัด game day อย่างสม่ำเสมอ](https://docs.aws.amazon.com/wellarchitected/latest/reliability-pillar/rel_testing_resiliency_game_days_resiliency.html)

DiRT (Disaster Recovery Testing) ของ Google คือไอเดียเดียวกันในระดับทั้งบริษัท: outage ทั้งจริงและสมมติที่ประสานกัน รันภายใต้กติกาที่ประกาศไว้ (เหตุฉุกเฉินจริงมาก่อน ผลกระทบที่คาดไว้ตกลงกันล่วงหน้า) และทดสอบทั้งกระบวนการ คน และระบบ เช่นทำให้คนที่มีความรู้ที่ไม่ได้เขียนไว้ในเอกสารติดต่อไม่ได้ Google อธิบายเรื่องนี้ไว้ใน [Using SRE and disaster recovery testing principles in production](https://cloud.google.com/blog/products/management-tools/shrinking-the-time-to-mitigate-production-incidents)

แผน disaster recovery ก็ต้องทำแบบเดียวกัน [disaster recovery strategy](../disaster-recovery-strategies/) ที่ไม่เคยซ้อมเลยก็แค่ความหวัง: ลอง restore backup, promote ตัว standby, fail over ไปอีก region แบบใน [active-passive failover](../active-passive-failover/) แล้ววัดเวลากู้คืนและข้อมูลที่หายไป เทียบกับ RTO และ RPO ที่สัญญาไว้

### การทดลองมักเจออะไร

- **Timeout ที่ไม่มีหรือตั้งไว้หลวมเกิน** แบบใน diagram: dependency ที่ช้าตัวเดียวดึง thread และ connection ของผู้เรียกไว้จนทุกอย่างต้องรอ วิธีแก้คือ [timeout และ fallback](../timeout-and-fallback/)
- **Retry storm**: ทุก layer retry ทำให้โหลดบน dependency ที่ลำบากอยู่แล้วทวีคูณ วิธีแก้คือ [retry แบบมี backoff และ jitter](../retry-with-backoff/) และเพดานจำนวน retry
- **Pool ที่ใช้ร่วมกัน**: ความช้าของ dependency ตัวเดียวกิน pool ที่ทุกการเรียกใช้ร่วมกันจนหมด วิธีแก้คือ [bulkhead](../bulkhead/) ต่อ dependency และ [circuit breaker](../circuit-breaker/) ที่หยุดเรียกมัน
- **Health check ที่ตรวจผิดเรื่อง**: instance รายงานว่า healthy ทั้งที่ request ของมัน fail หรือ deep check เอาทุก instance ออกพร้อมกัน ดู [health endpoint monitoring](../health-endpoint-monitoring/)
- **Fallback ที่ใช้ไม่ได้** เพราะมันรันแค่ตอนมี failure เท่านั้น ตัว ChAP จับ fallback path ที่พังของ Netflix ได้ด้วยวิธีนี้
- **Capacity ที่ไม่มีอยู่จริง**: หลังเสีย zone ไป instance ที่เหลือรับโหลดไม่ไหว หรือ [auto scaling](../autoscaling/) ตอบสนองช้าเกินกว่าจะช่วยได้
- **Alert, dashboard และ runbook** ที่ไม่มี ดังมั่ว หรือล้าสมัย และเจ้าของที่ติดต่อไม่ได้

### มันไม่ใช่อะไร

- **ไม่ใช่การทำของพังแบบสุ่ม ๆ** Chaos Monkey สุ่มเลือกเหยื่อก็จริง แต่ทำอยู่ในโปรแกรมที่วางแผน เฝ้าดู และจำกัดขอบเขตไว้แล้ว การสุ่มใช้เลือกเป้าได้ แต่ไม่ได้มาแทนวิธีการ การทดลองทุกครั้งมีสมมติฐาน, limit และ stop condition
- **ไม่ใช่ load testing** load test ถามว่าระบบรับ traffic ได้แค่ไหน ส่วน chaos experiment ถามว่าจะเกิดอะไรขึ้นตอนที่บางส่วนของมันล้ม สองอย่างนี้ใช้ร่วมกันได้ดี (zone ล่มตอนโหลด peak) แต่ตอบคนละคำถาม
- **ไม่ได้มาแทนการทดสอบแบบอื่น** unit test, integration test, performance test และ security test ยังสำคัญอยู่ chaos experiment ทดสอบระบบที่รันอยู่ทั้งระบบ

## ใช้ตอนไหนดี

- เราพึ่งกลไก resilience (redundancy, failover, timeout, retry, circuit breaker, auto scaling) อยู่ แต่ช่วงหลังไม่เคยเห็นมันทำงานจริง
- ระบบ distributed มากพอที่พฤติกรรมตอนล้มจะเดาจาก design ได้ไม่ชัด
- หลังเกิด incident เพื่อพิสูจน์ว่าวิธีแก้ใช้ได้ และ fault แบบเดิมไม่ทำให้เจ็บอีกแล้ว
- ก่อนช่วง peak, migration หรือ launch ที่ทำให้ outage มีราคาแพง
- ตอนที่ต้องแสดงหลักฐานเรื่อง resilience เอกสารของ Azure Chaos Studio พูดถึงการใช้ scenario report เป็นหลักฐานให้ operational resilience framework อย่าง DORA

**ตอนไหนยังไม่ควรเริ่ม:**

- ยังไม่มี metric ของ steady state หรือดูมันแบบเกือบ real time ไม่ได้
- หยุดการทดลองหรือถอด fault ออกได้ไม่เร็ว
- รู้จุดอ่อนอยู่แล้วแต่ยังไม่ได้แก้
- ไม่มีอะไร redundant ให้ทดสอบ: ถ้ามี instance เดียว การ terminate มันคือ outage ไม่ใช่การทดลอง
- ไม่มีใคร on-call คอยรับมือ ฝ่ายบริหารไม่สนับสนุนการตั้งใจทำให้ล้ม หรือ error budget หมดแล้ว

ในกรณีพวกนี้ ให้เริ่มจาก observability, แก้จุดที่รู้อยู่แล้ว และจัด game day ใน pre-production environment

## ได้อะไร เสียอะไร

- **ความเสี่ยงจริง** แม้แต่การทดลองเล็ก ๆ ที่ป้องกันไว้ดีก็ทำร้ายลูกค้าได้ ต้นทุนนี้เป็นสิ่งที่ตั้งใจจ่าย และควรหักจาก error budget
- **แรงที่ต้องลง** การทดลอง, automation, การเลือกเป้าให้ปลอดภัย และการวิเคราะห์ ต้องใช้เวลาของ engineer และการแก้สิ่งที่เจอก็ต้องใช้เพิ่มอีก
- **ผ่านแล้วพิสูจน์ได้น้อยกว่าที่คิด** มันแค่แสดงว่า fault นี้ ขนาดนี้ ในจังหวะนี้ ระบบทนได้ ระบบเปลี่ยนไปเรื่อย ๆ การทดลองถึงควรรันอย่างต่อเนื่อง
- **Blast radius เล็กก็ได้สัญญาณเล็ก** fault ที่แตะ traffic 1% มีผลเล็กที่ความแปรปรวนตามปกติในแต่ละวันกลบได้ control group กับ metric ที่ไวช่วยได้
- **คนและวัฒนธรรม** ทีมต้องยอมตั้งใจทำของพัง และรับมือกับสิ่งที่เจอโดยไม่โทษกัน ถ้าไม่มีตรงนี้ การทดลองจะโดนยกเลิกตั้งแต่เห็นปัญหาแวบแรก หรือไม่ได้เริ่มเลย

## ข้อควรรู้ตอนลงมือทำ

- **Managed service:** AWS Fault Injection Service สร้างการทดลองจาก template ของ action, target และ stop condition มี scenario library (รวมถึง AZ power interruption) และ [ตั้งเวลาการทดลอง](https://docs.aws.amazon.com/fis/latest/userguide/experiment-scheduler.html) ผ่าน EventBridge Scheduler ได้ [Azure Chaos Studio](https://learn.microsoft.com/en-us/azure/chaos-studio/chaos-studio-overview) กำลังย้ายจาก Experiments (classic) ที่มี fault แบบ service-direct และ agent-based ไปเป็น Workspaces และ Scenarios ที่ ณ เดือนตุลาคม 2026 ยังเป็น public preview อยู่
- **Open source:** [Chaos Mesh](https://chaos-mesh.org/) และ [LitmusChaos](https://litmuschaos.io/) เป็นโปรเจกต์ CNCF ระดับ incubating ที่รองรับ Kubernetes แบบ native ส่วน Chaos Monkey ของ Netflix ก็ terminate instance ผ่าน Spinnaker
- **Commercial:** [Gremlin](https://www.gremlin.com/) ให้บริการ fault injection และ reliability testing แบบ as a service
- **ทำการทดลองเป็นโค้ด** เก็บไว้ใน version control ข้าง ๆ service, review มัน และรันมันทั้งใน delivery pipeline และตามตารางเวลา
- **Mark การทดลองไว้ตรงที่คนมองเห็น** ใส่ annotation บน dashboard ทุกครั้งที่เริ่มและจบ ติด tag ให้ request ที่โดนผลกระทบถ้าทำได้ และประกาศปฏิทินการทดลองที่วางแผนไว้
- **บันทึกทุกรอบที่รัน:** สมมติฐาน ผลลัพธ์ สิ่งที่เจอ และ ticket ที่เกิดขึ้นจากสิ่งที่เจอ รายการสิ่งที่เจอนี่แหละคือผลผลิตจริง
- **ขยายทีละขั้น** instance เดียว แล้วไปเป็น zone แล้วไปเป็น region ส่วน request ก็เริ่มจากไม่กี่เปอร์เซ็นต์ แล้วค่อยเพิ่ม ขยับขึ้นก็ต่อเมื่อผ่านแล้วเท่านั้น
- **อ่านเพิ่มเติม:** Casey Rosenthal และ Nora Jones, *Chaos Engineering: System Resiliency in Practice* (O'Reilly, 2020)
