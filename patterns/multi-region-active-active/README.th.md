## ปัญหา

region เดียวก็คือ failure domain เดียว การกระจาย instance ไปหลาย availability zone ช่วยให้รอดตอนเสีย data centre ไปทั้งศูนย์ แต่ไม่รอดเหตุการณ์ระดับ region อย่างปัญหา network หรือไฟฟ้า การแก้ regional service ผิด หรือภัยธรรมชาติ การ serve ผู้ใช้ทั่วโลกจาก region เดียวยังทำให้ผู้ใช้ที่อยู่ไกลต้องเสีย round trip ข้ามทวีปทุก request ด้วย ส่วน standby แบบ active-passive ช่วยเรื่องการกู้คืนได้ แต่ไม่ช่วยเรื่อง latency มันนั่งว่างอยู่เกือบตลอดเวลา และเส้นทาง failover ของมันก็ได้ใช้น้อยมากจนไว้ใจได้ยาก

## ทำงานยังไง

- **ทุก region รัน stack ครบชุด** (app tier และสำเนาข้อมูลที่เขียนได้) และ **รับ traffic จริงตลอดเวลา** ไม่มี standby ให้ต้อง promote
- **global load balancer** ส่งผู้ใช้แต่ละคนไปที่ region ที่ healthy และใกล้ที่สุด มีสองแบบคือ **แบบใช้ DNS** (routing ตาม latency, geolocation หรือ geoproximity: คำตอบของการ lookup ชื่อจะชี้ไปที่ region หนึ่ง) หรือ **แบบ anycast** (IP address เดียวที่ประกาศจาก edge location หลายแห่ง แล้ว edge จะ proxy แต่ละ connection ไปที่ region ที่ healthy และใกล้ที่สุด)
- มันคอย **health check** ทุก region ดีที่สุดคือผ่าน endpoint ที่ลองเรียก dependency สำคัญของ region นั้นจริง ๆ แล้วจะหยุดส่ง traffic ไปที่ region ที่ probe ล้มเหลวติดกันไม่กี่ครั้ง
- **การอ่านใช้ข้อมูลใน region ตัวเอง** ส่วนการเขียนจะ **commit ใน region ตัวเอง** แล้ว replicate ไป region อื่นแบบ **asynchronous** เลยไม่มี request ไหนต้องรอ round trip ข้าม region
- พอ region หนึ่งพัง ผู้ใช้ของมันก็ถูก route ไปที่ region ที่ยังรอด ตัว region พวกนั้นรับ traffic จริงอยู่แล้ว failover เลยเป็นแค่การเปลี่ยน routing ไม่ใช่การ promote

## ใช้ตอนไหนดี

- เป้า availability ที่รับ outage ระดับ region ไม่ได้ หรือแม้แต่รับไม่ได้กับเวลาไม่กี่นาทีที่การ promote แบบ active-passive ต้องใช้ (RTO เกือบศูนย์)
- ผู้ใช้กระจายอยู่หลายทวีป และการ serve จาก region ที่ใกล้ที่สุดช่วยลด latency ได้ชัดเจน
- ข้อมูลที่ยอม eventual consistency ระหว่าง region ได้ หรือแบ่ง partition ได้จนแต่ละ record มี home region เดียว
- ไม่ควรใช้ถ้า warm standby ก็ผ่าน RTO และ RPO ของคุณอยู่แล้ว เพราะ active-active ทำให้ค่า infrastructure เพิ่มราวสองเท่า และทำให้ data consistency กลายเป็นเรื่องที่ทุก feature ต้องคิด

## ได้อะไร เสียอะไร

- **replication แบบ asynchronous แปลว่า RPO > 0** การเขียนที่ Region B commit แล้วแต่ยังไม่ได้ส่งไป A ตอนที่ B พัง จะหายไป หรือค้างอยู่จนกว่า B จะกลับมาแล้ว reconcile ได้ ช่วงที่เสี่ยงก็คือ replication lag ตัว lag นี้ปกติไม่ถึงหนึ่งวินาที แต่จะยาวขึ้นตอน load สูง หรือตอน link ระหว่าง region แย่ลง เลยต้องวัดไว้ ส่วน replication แบบ synchronous ข้าม region (quorum write) ให้ RPO = 0 แต่การเขียนทุกครั้งต้องเสีย round trip ข้าม region และการเขียนจะหยุดเมื่อได้ quorum ไม่ครบ
- **การเขียนพร้อมกันจะ conflict** สอง region อาจ update record เดียวกันภายในช่วง lag นี้ ถ้าใช้ *last-writer-wins* ตาม timestamp ก็ทำง่าย แต่จะทิ้ง update ตัวหนึ่งไปเงียบ ๆ *การ merge* (CRDT หรือการ resolve ในระดับ application) เก็บเจตนาของทั้งสองฝั่งไว้ได้ แต่ใช้ได้แค่กับข้อมูลที่ merge ได้ อีกทางคือเลี่ยงไม่ให้ conflict เลย: ให้แต่ละ key มี **writer ตัวเดียว** อาจเป็น write region เดียวทั่วโลก ("write global") หรือ home region ต่อ partition เช่น region ของผู้ใช้เอง ("write partitioned") ส่วนการอ่านยังทำใน region ตัวเอง หลายระบบผสมกัน ใช้ writer ตัวเดียวสำหรับยอดเงินกับ inventory และใช้ last-writer-wins สำหรับ preference
- **แต่ละ region ต้องมี headroom ไว้รับ load ของเพื่อนบ้าน** พอ region ขนาดเท่ากัน *N* ตัวพังไปหนึ่งตัว แต่ละ region ที่รอดต้องรับ load *N/(N−1)* เท่าของปกติ ถ้ามีสอง region ก็คือสองเท่า แต่ละ region เลยต้องรันที่ utilisation 50% หรือต่ำกว่าในเวลาปกติ การ scale out ระหว่างเกิดเหตุเป็นการเสี่ยงดวง: ใช้เวลาหลายนาที ต้องพึ่ง control plane และต้องแย่ง capacity กับทุกคนที่กำลัง failover อยู่เหมือนกัน ส่วน capacity ที่เตรียมไว้ล่วงหน้า (*static stability*) ปลอดภัยกว่า และยิ่งมี region มาก headroom ที่แต่ละ region ต้องเผื่อก็ยิ่งน้อยลง
- **failover เร็วแค่ไหนขึ้นกับ routing layer** การตรวจเจอว่าพังใช้เวลาราว probe interval คูณ failure threshold ถ้าใช้ DNS ก็ต้องรอ TTL ของ record ต่ออีก และ resolver กับ client บางตัวก็ cache คำตอบไว้นานกว่านั้น ด้าน connection ที่เปิดค้างไว้นาน (HTTP/2, gRPC, WebSockets) จะไม่ resolve ใหม่จนกว่าจะ reconnect ส่วน anycast ใช้ IP address เดิม การย้ายเลยเกิดใน network ของ provider ทันทีที่ health check mark ว่า region ล่ม โดย client ไม่ต้องช่วยอะไร
- **data residency** การ replicate ทุกอย่างไปทุกที่อาจขัดกับกฎ data protection และ localisation เช่นข้อจำกัดของ GDPR เรื่องการส่งข้อมูลออกนอก EEA ให้เก็บ record ที่อยู่ใต้กฎไว้ใน home region ของมัน แล้ว replicate เฉพาะส่วนที่ออกไปได้ หรือรัน active-active แค่ระหว่าง region ที่อยู่ใต้กฎหมายเดียวกัน
- **ต้นทุนและภาระงาน operation** คุณต้องจ่ายค่าสำเนา stack เต็มชุดและค่า data transfer ข้าม region และตอนนี้ทุก deployment, schema change และ incident ก็ต้องทำข้ามหลาย region

## ข้อควรรู้ตอนลงมือทำ

- **Global routing** ตัวอย่างแบบใช้ DNS คือ record แบบ latency หรือ geoproximity ของ Amazon Route 53 ที่มี health check, Azure Traffic Manager, routing policy ของ Google Cloud DNS และ NS1 ส่วนตัวอย่างแบบ anycast edge คือ AWS Global Accelerator, Azure Front Door, global external Application Load Balancer ของ Google Cloud และ Cloudflare
- **ข้อมูลแบบ multi-writer** Amazon DynamoDB global tables (ในโหมด multi-region eventual consistency ที่เป็นค่า default) และ Azure Cosmos DB ที่เปิด multi-region writes จะ replicate แบบ asynchronous และ resolve conflict ด้วย last-writer-wins เป็นค่า default (Cosmos DB รัน custom merge procedure ได้ด้วย) ส่วนโหมด multi-region strong consistency ของ DynamoDB จะ replicate การเขียนแต่ละครั้งแบบ synchronous ไปอย่างน้อยอีกหนึ่ง region ก่อน acknowledge (RPO = 0, ต้องมีสาม region พอดี, latency ตอนเขียนสูงขึ้น) Cassandra และ ScyllaDB replicate ระหว่าง data centre โดยกำหนด consistency level ได้ต่อ request เช่น `LOCAL_QUORUM` ส่วน Spanner และ CockroachDB ใช้ synchronous consensus แทน (RPO = 0, latency ตอนเขียนสูงขึ้น) และ table แบบ `REGIONAL BY ROW` ของ CockroachDB ให้แต่ละ row มี home region
- **ให้ผู้ใช้อยู่ region เดียว** route ผู้ใช้แต่ละคนไป region เดิมเสมอ เพื่อให้เขาอ่านเจอสิ่งที่ตัวเองเพิ่งเขียน ทำ app tier ให้ stateless (เก็บ session ใน signed token หรือ store ที่ replicate) และทำการเขียนให้ idempotent เพื่อให้ request ที่ retry ใน region อื่นหลัง failover ไม่มีผลซ้ำ
- **คอยดู lag** export replication lag เป็น metric และตั้ง alert ให้ดังตั้งแต่เนิ่น ๆ ก่อนที่มันจะเกินงบ RPO แล้วก็ออกแบบ health check ให้จับ dependency ที่พังได้ แต่ต้องแน่ใจว่า dependency ที่แชร์กันตัวเดียวจะไม่ทำให้ทุก region ถูก mark ว่า unhealthy พร้อมกัน
- **ซ้อมอพยพ** drain region ทิ้งโดยตั้งใจเป็นประจำ (game day, chaos experiment) เพื่อพิสูจน์ว่า region อื่นรับ load ไหว พอ region ที่พังกลับมา ให้มันไล่ replicate ให้ทันและ warm up ก่อน แล้วค่อย ๆ ย้าย traffic กลับ
