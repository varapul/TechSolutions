## ปัญหา

งานบางอย่างต้องให้ instance ทำทีละตัว billing run ประจำคืนต้องรันครั้งเดียว ไม่ใช่ replica ละครั้ง resource บางตัวรับคนเขียนได้ทีละคน partition ชุดหนึ่งต้องมีเจ้าของตัวเดียวพอดีต่อ partition และ database ที่ replicate ต้องมี primary ตัวเดียวไว้เรียงลำดับการเขียน แต่ service ที่ทำงานพวกนี้รันอยู่หลาย instance ที่เหมือนกัน เพราะ instance เดียวคือ single point of failure

ทางแก้ที่เห็นได้ชัดสองทางพังทั้งคู่ ถ้าเปิด job ไว้ทุก instance ทุกตัวก็รันมัน: ลูกค้าโดนเก็บเงิน replica ละครั้ง ถ้าเปิดไว้แค่ instance เดียว ตัวนั้นก็กลายเป็นจุดล้มเหลวตายตัว: พอมันตาย ก็ไม่มีอะไรรันเลยจนกว่าจะมีคนสังเกตเห็น ที่ต้องการคือวิธีให้ peer ที่เหมือนกันตกลงเลือกกันเองหนึ่งตัว แล้วส่งบทบาทต่อให้อีกตัวโดยอัตโนมัติเมื่อตัวที่ถืออยู่หยุดไป โดยไม่มีวันปล่อยให้สองตัวทำงานพร้อมกัน

## ทำงานยังไง

instance ทุกตัวใช้ record เล็ก ๆ ตัวเดียวร่วมกันใน **coordination store** ที่ strongly consistent: เป็น lease ที่บอกว่าใครถือบทบาทอยู่ ถือได้นานแค่ไหน ต่ออายุครั้งล่าสุดเมื่อไร และมี **fencing token** คือตัวเลขที่เพิ่มขึ้นทุกครั้งที่บทบาทเปลี่ยนมือ

1. **ชิงตำแหน่ง** ทุก instance พยายามเขียนชื่อตัวเองลงใน lease ด้วย compare-and-set แบบ atomic ที่สำเร็จก็ต่อเมื่อ lease ว่างหรือหมดอายุแล้ว store จัดการความพยายามทีละครั้ง เลยมีตัวเดียวพอดีที่สำเร็จ ตัวนั้นคือ **leader** ส่วนตัวอื่นเป็น **follower** และคอยเฝ้าดู lease ต่อไป
2. **ต่ออายุ** leader เขียน lease ใหม่ก่อนมันจะหมดนาน ๆ (ใน diagram คือทุก 5 วินาทีสำหรับ lease 15 วินาที) ตราบใดที่มันยังทำแบบนี้อยู่ ก็ไม่มีใครเอาไปได้ ถ้ามันต่ออายุไม่ทัน มันต้องเลิกทำตัวเป็น leader เอง
3. **หมดอายุแล้วขึ้นแทน** ถ้าการต่ออายุหยุดไป เพราะ leader crash, network หลุด หรือค้างไป ตัว lease ก็จะหมดอายุ แล้ว compare-and-set ของ follower ตัวถัดไปก็สำเร็จ leader ตัวใหม่ได้ token ที่สูงกว่า ระหว่างการต่ออายุครั้งสุดท้ายกับการขึ้นแทน งานจะรออยู่ได้นานสุดหนึ่งช่วงอายุ lease
4. **Fence** leader ส่ง token ไปพร้อมทุกอย่างที่ทำกับ resource ที่ใช้ร่วมกัน และ resource ก็ปฏิเสธ token ไหนก็ตามที่ต่ำกว่าตัวสูงสุดที่เคยรับไว้ leader ที่โดนปลดไปแล้วแต่ยังไม่รู้ตัวก็โดนหยุดไว้ตรงนั้น ที่ resource

leader ที่ shut down อย่างเรียบร้อยควรปล่อย lease ไป follower จะได้ขึ้นแทนทันทีไม่ต้องรอให้หมดอายุ แต่ต้องทำหลังจากงานของตัวเองหยุดแล้วเท่านั้น

### มีแค่ lease ไม่พอ: fencing token

lease ให้ช่วงเวลามาช่วงหนึ่ง แต่ไม่มีอะไรบังคับให้ process รู้ตัวว่าเวลาหมดแล้ว garbage-collection pause นาน ๆ, virtual machine ที่โดน freeze แล้ว resume, disk ที่ช้า หรือ network packet ที่มาช้า อาจทำให้ leader ค้างอยู่ระหว่างตรวจ lease กับลงมือทำ พอกลับมาทำงาน lease อาจเป็นของคนอื่นไปแล้ว แต่ leader เก่าก็ทำต่อไปไม่สนอะไร clock ก็ทำให้เรื่องนี้แย่ลง เพราะ lease คือคำสัญญาเรื่องเวลาที่ผ่านไป clock ที่เดินเร็วหรือกระโดดก็ทำให้ process เชื่อว่ายังมีเวลาเหลืออยู่ [บทความของ Amazon Builders' Library เรื่อง leader election](https://builder.aws.com/content/3Ev0vH0hfkcUizISUWYTvHibtcp/leader-election-in-distributed-systems) ยกกรณีพวกนี้ขึ้นมาตรง ๆ คือการค้างระหว่างตรวจ lock กับลงมือทำงาน และ leader ที่อยู่บน network ช้าหรือทำ packet หาย ว่าเป็นส่วนที่ทำให้ถูกได้ยากที่สุด

บทความ [How to do distributed locking](https://martin.kleppmann.com/2016/02/08/how-to-do-distributed-locking.html) ของ Martin Kleppmann อธิบายวิธีแก้ที่ใช้ใน diagram การให้สิทธิ์แต่ละครั้งมาพร้อม token ที่เพิ่มขึ้นแบบ monotonic ตัว client ส่ง token ไปกับทุก request และ storage service ก็ปฏิเสธ request ไหนก็ตามที่ token ต่ำกว่าตัวที่เคยประมวลผลไปแล้ว resource ต้องมีส่วนร่วมด้วย: การตรวจต้องเกิดใน operation แบบ atomic เดียวกับการเขียน เช่น conditional update ที่เทียบ token ที่เข้ามากับตัวสูงสุดที่เก็บไว้ บทความนี้ยังแยกเหตุผลที่อยากได้ lock ไว้สองแบบ ถ้าเป็น lock เพื่อ**ประสิทธิภาพ** งานซ้ำบ้างเป็นครั้งคราวก็แค่เปลืองงาน ถ้าเป็น lock เพื่อ**ความถูกต้อง** งานซ้ำจะทำข้อมูลเสียหรือเก็บเงินลูกค้าสองรอบ และมีแค่ fencing ที่ทำให้มันปลอดภัย

token มาจากไหนขึ้นกับ store:

- **etcd:** revision ของ election key หรือ lock key ส่วน [notes on lock and lease](https://etcd.io/docs/v3.6/learning/why/#notes-on-the-usage-of-lock-and-lease) ของ etcd เองก็ชี้ว่า lease อย่างเดียวไม่ได้ให้ mutual exclusion และแนะนำให้ใช้ revision เป็น fencing token
- **ZooKeeper:** zxid หรือ znode version ตามตัวอย่างของ Kleppmann
- **Consul:** `LockIndex` ของ key ที่เพิ่มขึ้นทุกครั้งที่มีคนได้ lock พอเอามารวมกับ key และ session มันก็กลายเป็นสิ่งที่ Consul เรียกว่า sequencer เป็นไอเดียที่ยืมมาจาก Chubby ของ Google
- **Kubernetes:** Lease นับการเปลี่ยนคนถือไว้ใน `leaseTransitions` แต่ client-go ไม่ได้ส่งค่านี้ให้โค้ดของเราใช้เป็น token และ [เอกสารของ package](https://pkg.go.dev/k8s.io/client-go/tools/leaderelection) ก็บอกตรง ๆ ว่ามันไม่รับประกันว่าจะมี client ทำตัวเป็น leader แค่ตัวเดียว เรื่อง fencing เป็นหน้าที่ของเราเอง
- **Row ใน database:** generation column ที่เพิ่มขึ้นทุกครั้งที่มีคนขึ้นแทน

ถ้า resource ตรวจ token ไม่ได้ (API ของ third party หรือผู้ให้บริการ email) ให้ทำ operation ให้ idempotent แทน: เช่นให้ billing run แต่ละครั้งมี idempotency key อย่างลูกค้ากับรอบบิล ความพยายามครั้งที่สองจะได้ไม่เปลี่ยนอะไรเลย

### จังหวะเวลา: lease duration, renew deadline, retry period

ค่าสามตัวนี้ตัดสินว่า leadership ย้ายเร็วแค่ไหน และย้ายผิด ๆ บ่อยแค่ไหน:

- **Lease duration:** follower รอนานเท่าไรหลังการต่ออายุครั้งล่าสุดที่เห็น ก่อนจะพยายามขึ้นแทน มันเป็นเพดานว่างานจะหยุดได้นานแค่ไหนตอน leader ตายแบบเงียบ ๆ
- **Renew deadline:** leader จะ retry การต่ออายุที่ล้มเหลวไปนานเท่าไรก่อนยอมแพ้และเลิกเป็น leader ค่านี้ต้องสั้นกว่า lease duration เพื่อให้ leader เก่าหยุดก่อนที่คนอื่นจะเริ่มได้ ส่วนต่างคือ margin เผื่อ clock ที่เดินด้วยอัตราต่างกันนิดหน่อย
- **Retry period:** candidate พยายามยึด lease บ่อยแค่ไหน และ leader พยายามต่ออายุบ่อยแค่ไหน

Kubernetes control plane เป็นตัวอ้างอิงที่ดี: [kube-controller-manager](https://kubernetes.io/docs/reference/command-line-tools-reference/kube-controller-manager/) ใช้ค่า default คือ lease duration 15 วินาที renew deadline 10 วินาที และ retry period 2 วินาที เก็บไว้ใน Lease object ส่วน client-go ไม่ยอมรับค่าที่เรียงผิดลำดับ: lease duration ต้องยาวกว่า renew deadline และ renew deadline ต้องยาวกว่า 1.2 เท่าของ retry period ค่า default ของ kube-controller-manager คือ exit ทันทีที่เสีย leadership ไป controller ที่โดนปลดเลยทำงานต่อไม่ได้

lease ที่สั้นกว่าทำ failover ได้เร็วกว่า แต่ก็หมดอายุบ่อยกว่าตอนเจอการค้างนาน ๆ หรือ CPU ไม่พอ ทำให้เปลี่ยน leader โดยไม่จำเป็น lease ที่ยาวกว่านิ่งกว่า แต่งานก็หยุดนานกว่าตอนที่ leader ตายจริง

lease พึ่งการวัดเวลาที่ผ่านไป ไม่ได้พึ่งการตกลงกันว่าตอนนี้กี่โมง follower ของ client-go จับเวลา lease ตั้งแต่ตอนที่เห็น record เปลี่ยน โดยใช้ clock ของตัวเอง และถือว่า timestamp ใน record เป็นแค่สัญญาณว่ามันเปลี่ยนแล้ว clock ที่บอกเวลาไม่ตรงกันเลยไม่เป็นปัญหา แต่ clock ที่เดินด้วยความเร็วต่างกันเป็นปัญหา [DynamoDB lock client](https://github.com/awslabs/amazon-dynamodb-lock-client) ไม่เก็บเวลาแบบ absolute เลย: client ที่รออยู่จะเริ่มจับเวลา แล้วถือว่า lock นั้น stale ถ้า record version number ไม่เปลี่ยนเลยตลอดหนึ่งช่วง lease duration ส่วนในตัว leader ให้วัด lease ด้วย monotonic clock การปรับ clock หรือ leap second จะได้ยืดมันออกไม่ได้

### กลไก

| Store | การขึ้นเป็น leader | การรู้ว่า leader ตาย | Fencing token |
|---|---|---|---|
| Kubernetes Lease กับ client-go `leaderelection` | update Lease โดยมี optimistic concurrency คุมไว้ | follower รอจนครบ lease duration หลังการต่ออายุครั้งล่าสุดที่เห็น | ไม่มีให้ ส่วน `leaseTransitions` นับการเปลี่ยนคนถือ |
| etcd | `Campaign` ใน election API หรือ transaction ที่สร้าง key ผูกกับ lease | keep-alive หยุด TTL ของ lease หมด แล้ว key ของมันก็โดนลบ | revision ของ key |
| ZooKeeper | สร้าง ephemeral sequential znode ตัวที่เลขต่ำสุดเป็น leader | session timeout แล้ว ephemeral znode ของมันก็หายไป | zxid หรือ znode version |
| Consul | ยึด key-value entry ด้วย session | health check ของ session fail หรือ TTL ของมันหมด | `LockIndex` |
| Row ใน database | `UPDATE` แบบมีเงื่อนไขที่สำเร็จก็ต่อเมื่อ lease ว่างหรือหมดอายุแล้ว | เลยเวลาหมดอายุที่เก็บไว้ใน row | generation column |
| PostgreSQL advisory lock | `pg_try_advisory_lock` | database session ของคนถือจบลง | ไม่มี |
| Azure Blob Storage lease | ยึด lease 15 ถึง 60 วินาทีบน blob | lease ไม่ได้ต่ออายุทันเวลา | lease ID ที่คุมเฉพาะการเขียนลง blob นั้น |
| DynamoDB lock client | conditional write ลง lock item | record version number ไม่เปลี่ยนตลอดหนึ่งช่วง lease duration | ไม่มี: version number เป็น identifier แบบสุ่ม |

- **Kubernetes:** kube-controller-manager กับ kube-scheduler ใช้ [Lease](https://kubernetes.io/docs/concepts/architecture/leases/) เพื่อให้มี replica ของแต่ละตัว active อยู่ตัวเดียว และ controller ของเราเองก็ทำแบบเดียวกันได้ผ่าน package `leaderelection` ของ client-go (callback `OnStartedLeading`, `OnStoppedLeading` และ `OnNewLeader` และ `ReleaseOnCancel` ไว้ปล่อย lease ตอน shut down) ส่วน Coordinated leader election ที่เป็น beta ตั้งแต่ Kubernetes 1.33 และปิดไว้เป็นค่า default เพิ่ม object `LeaseCandidate` เข้ามา control plane จะได้เลือก leader อย่างตั้งใจ เช่นเลือก version เก่าสุดระหว่าง upgrade ฟีเจอร์นี้ทำมาสำหรับ component ของ control plane
- **etcd:** [lease](https://etcd.io/docs/v3.6/learning/api/) มี TTL และต้องคอย keep alive พอมันหมดอายุหรือโดน revoke ทุก key ที่ผูกอยู่ก็โดนลบ [election service](https://etcd.io/docs/v3.6/dev-guide/api_concurrency_reference_v3/) มี `Campaign`, `Proclaim`, `Leader`, `Observe` และ `Resign` ให้ใช้บนกลไกนั้น
- **ZooKeeper:** [leader election recipe](https://zookeeper.apache.org/doc/current/recipes.html#sc_leaderElection) ให้ candidate ทุกตัวสร้าง ephemeral sequential znode ไว้ใต้ path เดียวกัน ตัวที่ sequence number น้อยสุดเป็น leader ถ้า follower ทุกตัวเฝ้าดู node ของ leader พวกมันทั้งหมดก็จะตื่นขึ้นมา query ZooKeeper ทุกครั้งที่มีการเปลี่ยน กลายเป็น burst ที่เรียกว่า **herd effect** แต่ละตัวเลยเฝ้าดูแค่ node ถัดไปที่อยู่ต่ำกว่าของตัวเอง Apache Curator ทำเรื่องนี้ไว้ให้เป็น `LeaderLatch` กับ `LeaderSelector`
- **Consul:** [session](https://developer.hashicorp.com/consul/docs/automate/session) ผูก lock ไว้กับ health check ของ node หรือกับ TTL ตั้งแต่ 10 วินาทีถึง 24 ชั่วโมง และ Consul อาจรอได้ถึงสองเท่าของ TTL ก่อนจะ invalidate session หลัง invalidate แล้ว Consul กันไม่ให้ใครเอา lock ไปในช่วง lock-delay (15 วินาทีเป็นค่า default สูงสุด 60) leader ที่ยังรันอยู่จะได้มีเวลารู้ตัวและหยุด เอกสารของ Consul เองก็บอกว่าวิธีนี้ไม่ได้กันได้ 100%
- **Database ที่ใช้อยู่แล้ว:** lease row ที่มีคนถือ เวลาหมดอายุ และ generation แล้ว update ด้วย `UPDATE` แบบมีเงื่อนไข ไม่ต้องมี infrastructure เพิ่ม และเพราะ clock ของ database เป็นตัวตัดสินการหมดอายุ ตัว clock ของ instance เลยไม่มีผล [advisory lock](https://www.postgresql.org/docs/current/explicit-locking.html#ADVISORY-LOCKS) ของ PostgreSQL ง่ายกว่านั้นอีก: lock ระดับ session ถืออยู่จนกว่าจะปล่อยหรือ session จบ leadership เลยอยู่ได้นานเท่ากับ database connection หนึ่งเส้นพอดี วิธีนี้พังถ้าอยู่หลัง pooler ที่ใช้ transaction mode เพราะมันให้ server connection คนละเส้นกับแต่ละ transaction และ [PgBouncer](https://www.pgbouncer.org/features.html) ก็ระบุว่า advisory lock ระดับ session ใช้ไม่ได้ใน mode นั้น
- **Blob lease:** [ตัวอย่าง](https://learn.microsoft.com/en-us/azure/architecture/patterns/leader-election) ของ pattern ฝั่ง Azure เลือก leader ด้วยการยึด [lease บน blob](https://learn.microsoft.com/en-us/rest/api/storageservices/lease-blob) ต่ออายุใน loop และยกเลิกงานของ leader เมื่อการต่ออายุล้มเหลว การเขียนลง blob ที่มี lease ต้องแนบ lease ID ไปด้วย ตัว blob เลยได้รับการปกป้อง แต่อย่างอื่นที่ leader เขียนไม่ได้รับการปกป้อง
- **DynamoDB:** [DynamoDB lock client](https://github.com/awslabs/amazon-dynamodb-lock-client) เก็บ lock item ที่มี lease duration และ record version number ที่เปลี่ยนทุกครั้งที่ส่ง heartbeat บทความของ Builders' Library ยกตัวนี้พร้อมกับ ZooKeeper ว่าเป็นตัวเลือกที่ผ่านการทดสอบมาดี และทีมใน Amazon ก็เลือกใช้มากกว่าเขียนโค้ด election เอง

### Consensus ข้างใน cluster ส่วน lease อยู่ข้างนอก

ระบบที่ replicate เลือก leader ของตัวเองด้วย consensus protocol ใน Raft ([Ongaro and Ousterhout, USENIX ATC 2014](https://www.usenix.org/conference/atc14/technical-sessions/presentation/ongaro)) เวลาถูกแบ่งเป็น **term** ที่มีหมายเลขกำกับ ตัว candidate ต้องได้คะแนนเสียงจากเสียงข้างมาก และ server แต่ละตัวโหวตได้ไม่เกินหนึ่งครั้งต่อ term เลยมี leader ได้ไม่เกินหนึ่งตัวต่อ term ส่วน election timeout ก็ถูกสุ่ม (150 ถึง 300 มิลลิวินาทีในตัวอย่างของ paper) candidate จะได้แทบไม่แบ่งคะแนนกัน ตัว term คือ fencing token ที่มีมาในตัว: server ปฏิเสธ request ที่มี term เก่ากว่า และ leader ที่เห็น term ใหม่กว่าก็จะลงจากตำแหน่ง Raft ยังถูกต้องเสมอไม่ว่า clock หรือ message จะช้าแค่ไหน จังหวะเวลามีผลแค่ว่าจะเลือก leader ได้เร็วแค่ไหน etcd ทำงานแบบนี้ KRaft mode ของ Kafka ก็เช่นกัน โดยมี quorum ของ controller (ปกติ 3 หรือ 5 ตัว) ที่มี controller ตัวเดียว active และมี hot standby ส่วนหนังสือ *Patterns of Distributed Systems* ของ Unmesh Joshi อธิบายชิ้นส่วนเหล่านี้ไว้เป็น [Leader and Followers](https://martinfowler.com/articles/patterns-of-distributed-systems/leader-follower.html), [Lease](https://martinfowler.com/articles/patterns-of-distributed-systems/lease.html) และ [Generation Clock](https://martinfowler.com/articles/patterns-of-distributed-systems/generation-clock.html) (เรียกอีกชื่อว่า term หรือ epoch)

ความต่างนี้สำคัญตอนสร้างอะไรบนระบบแบบนี้ consensus ปกป้องข้อมูลข้างใน cluster เพราะตัว replica เองเป็นคนตรวจ term ส่วนแอปพลิเคชันที่ขอ lease จาก etcd หรือ ZooKeeper แค่ยืมการรับประกันนั้นมาใช้กับ lease record: อะไรก็ตามที่มันเขียนไปที่อื่นหลังจากนั้นอยู่นอกการปกป้อง และต้องใช้ fencing หรือ idempotence ส่วนในโค้ดของแอปพลิเคชัน การทำ leader election แทบทุกครั้งควรหมายถึงการยืม consensus จาก store ที่มีอยู่แล้ว ไม่ใช่ implement Raft เอง

## ใช้ตอนไหนดี

- **Job ตามตารางเวลาและ job ที่ต้องมีตัวเดียว** ที่ต้องรันครั้งเดียวต่อรอบทั่วทั้ง fleet: billing run รายงาน งาน clean-up ตัว relay ที่คอย poll
- **Resource ที่รับคนเขียนได้คนเดียว**: file, ledger หรือระบบปลายทางที่รับการเขียนพร้อมกันไม่ได้ หรือ stream ที่ต้องเขียนตามลำดับ
- **การแจกงาน**: coordinator ตัวเดียวแจก partition, shard หรือ tenant ให้ instance อื่น แล้ว rebalance เมื่อมี instance เข้าออก
- **Primary ของ store ที่ replicate** ที่เรียงลำดับทุกการเขียน ส่วนนี้ปกติ database ทำไว้ในตัวผ่าน consensus
- **Controller และ operator** ที่ควรมีแค่ replica เดียวลงมือกับ state ของ cluster ในแต่ละช่วงเวลา

### ตอนไหนไม่ควรใช้

leader election พา dependency ใหม่ ช่วงหยุดตอน failover และแบบที่ล้มเหลวที่มองไม่ค่อยเห็นเข้ามาด้วย บทความของ Builders' Library เล่าว่า Amazon ดูทางเลือกอื่นก่อน เช่น workflow service อย่าง AWS Step Functions และ API ที่ idempotent หรือ optimistic locking ที่ทำให้ไม่ต้องมี leader ตัวเดียว หลายครั้ง leader election ที่ดีที่สุดคือไม่ต้องมีเลย:

- **ทำงานให้ idempotent** instance ไหนจะทำก็ได้ และทำซ้ำก็ไม่มีผล: ดู [Idempotent Consumer](../idempotent-consumer/)
- **แบ่ง partition ของงาน** ทุก instance เป็นเจ้าของคนละส่วน เลยไม่ต้องมี leader กลาง: [Sharding](../sharding/) สำหรับข้อมูล และ [Competing Consumers](../competing-consumers/) สำหรับ message ใน queue
- **ให้ broker แจก partition** ใน Kafka consumer group ตัว group coordinator แจกแต่ละ partition ให้ consumer ตัวเดียวพอดี และแจกใหม่เมื่อ consumer ล้ม
- **ใช้ managed scheduler** เช่น Kubernetes CronJob, Amazon EventBridge Scheduler หรือ timer trigger ของ Azure Functions ตัวหลังสุดรัน function แค่ instance เดียวแม้แอปจะ scale out ไปแล้ว scheduler เองก็ไม่ได้สัญญาว่า exactly once: [CronJob](https://kubernetes.io/docs/concepts/workloads/controllers/cron-jobs/) สร้าง Job ประมาณหนึ่งครั้งต่อเวลาที่ตั้งไว้เท่านั้น บางทีก็สองครั้งหรือไม่สร้างเลย ส่วน [EventBridge Scheduler](https://docs.aws.amazon.com/scheduler/latest/UserGuide/what-is-scheduler.html) ส่งแบบ at least once ตัว job เองก็ยังต้อง idempotent อยู่ดี
- **ใช้ locking ธรรมดา** ถ้า instance แค่ต้องผลัดกันใช้ resource ที่ใช้ร่วมกัน: pattern ฝั่ง Azure แนะนำ optimistic หรือ pessimistic locking สำหรับกรณีนี้
- **ใช้ leader ตายตัวที่ restart ได้เร็ว** ถ้ายอมรับ outage สั้น ๆ ตอนมัน restart ได้ pattern ฝั่ง Azure ยก leader ที่มีอยู่โดยธรรมชาติหรือ process เฉพาะ ว่าเป็นเหตุผลที่ไม่ต้องใช้ election เลย

## ได้อะไร เสียอะไร

- **Coordination store กลายเป็นของสำคัญ** ตอนที่มันใช้ไม่ได้ ก็ไม่มีใครถูกเลือกได้ และ leader ก็ต่ออายุไม่ได้ pattern ฝั่ง Azure เลยเรียก mutex service ว่า single point of failure ให้รันมันแบบ highly available และให้แน่ใจว่า leader ที่ติดต่อมันไม่ได้จะหยุดภายใน renew deadline
- **Failover ไม่ได้เกิดทันที** งานจะหยุดได้นานสุดหนึ่ง lease duration บวกหนึ่ง retry period หลังการต่ออายุครั้งสุดท้ายของ leader ส่วน lease ที่สั้นลงลดช่วงหยุดนี้ได้ แต่ก็ทำให้ขึ้นแทนผิด ๆ บ่อยขึ้นตอนที่ leader ปกติดีแค่ช้าไป
- **อาจมี leader ศูนย์ตัวหรือสองตัวอยู่ชั่วขณะ** บทความของ Builders' Library บอกชัดว่าไม่มี distributed system ไหนรับประกันได้ว่าจะมี leader ตัวเดียวพอดี: ตอนเกิดความล้มเหลวอาจไม่มีเลยหรือมีสองตัว ต้องออกแบบรับทั้งสองกรณี: ช่วงหยุดที่ทนได้สำหรับกรณีไม่มี และ fencing หรือ idempotence สำหรับกรณีมีสองตัว
- **Leader ตัวเดียวคือคอขวดเดียวและ blast radius เดียว** งานที่ประสานกันทั้งหมดผ่าน instance ตัวเดียว ทำให้ throughput มีเพดาน และ leader ที่ผิดปกติก็กระทบทุกอย่างที่มันประสาน ทางแก้ที่ใช้กันคือแบ่ง leadership เป็น shard: หนึ่ง lease ต่อ partition แต่ละ partition จะได้มี leader ของตัวเอง แบบใน Amazon DynamoDB, EBS และ EFS หรือ lease ต่อ shard ของ Kinesis Client Library
- **Deploy ทีละส่วนยากขึ้น** พอมี instance active แค่ตัวเดียว ก็ไม่มี traffic ส่วนเล็ก ๆ ไว้ลอง version ใหม่ก่อน บทความของ Builders' Library ก็ชี้ต้นทุนข้อนี้ไว้เหมือนกัน
- **Leader อาจถือ lease อยู่แต่ไม่ได้ทำงาน** ถ้าการต่ออายุรันใน background thread ขณะที่ loop ของงานค้าง leader ก็ยังถือ lease และไม่มีใครขึ้นแทน ตัวอย่างของ Azure ก็บอกความเสี่ยงเดียวกันนี้ ให้ต่ออายุจาก loop ที่ทำงานจริง หรือผูกการต่ออายุไว้กับการตรวจว่างานยังคืบหน้าอยู่

## ข้อควรรู้ตอนลงมือทำ

- **ใช้ library** client-go `leaderelection`, election API ของ etcd หรือ package `concurrency` ฝั่ง Go ของมัน, Apache Curator, DynamoDB lock client หรือตัวที่เทียบเท่าบน platform ของเรา โค้ด election ที่ดูง่ายมักผิดแบบมองไม่ค่อยเห็นได้ง่าย
- **ตรวจก่อนทุก side effect** ตรวจเวลาที่เหลือของ lease ก่อน operation ไหนก็ตามที่มีผลนอกตัว leader และเผื่อ margin ไว้สำหรับการค้าง ตามที่บทความของ Builders' Library แนะนำ
- **เสีย leadership แล้วหยุดทันที** ยกเลิกงานของ leader ทั้งหมดเมื่อการต่ออายุล้มเหลวหรือ library แจ้งว่าเสียตำแหน่ง การ exit process แบบที่ kube-controller-manager ทำเป็นวิธีที่ทื่อที่สุดแต่ก็ปลอดภัยที่สุด
- **Fence ที่ resource** ส่ง token ไปกับทุกการเขียนและตรวจใน operation แบบ atomic เดียวกัน เช่น `UPDATE … SET …, fence_token = :token WHERE … AND fence_token <= :token` การเขียนที่ไม่ match row ไหนเลยแปลว่ามาจาก leader ที่ stale
- **ทำให้การขึ้นแทนปลอดภัย** leader ตัวใหม่อาจเจองานที่ทำค้างไว้ครึ่ง ๆ กลาง ๆ ให้แต่ละ step durable ก่อนบอกคนอื่นว่าเสร็จแล้ว และทำให้มัน idempotent leader ตัวใหม่จะได้ทำซ้ำอะไรก็ตามที่ตัวเก่าอาจเริ่มไว้ได้อย่างปลอดภัย
- **ทำให้เห็นว่าใครเป็น leader** เปิดให้เห็นว่าใครเป็น leader อยู่: library component-base ของ Kubernetes มี gauge `leader_election_master_status` ต่อ lease (1 สำหรับ leader, 0 สำหรับ standby) และ client-go บันทึก event `LeaderElection` ได้ทุกครั้งที่ instance ขึ้นเป็นหรือเลิกเป็น leader เก็บประวัติการเปลี่ยน leadership ไว้ และ alert เมื่อมันกระพริบ: เปลี่ยนหลายครั้งในเวลาสั้น ๆ ปกติแปลว่า lease สั้นเกินไปหรือ leader ไม่ได้ CPU พอ
- **ทดสอบการค้างและ partition** freeze leader ไว้นานกว่า lease (`SIGSTOP` แล้วตามด้วย `SIGCONT`) ตัดมันออกจาก store ทำให้ clock ของมันเพี้ยน แล้วตรวจว่า resource ปฏิเสธการเขียนที่ stale: ดู [Chaos Engineering](../chaos-engineering/) บทความของ Builders' Library ยังแนะนำให้ model protocol แบบ formal ด้วย เช่นใน TLA+
- **รู้จัก pattern ข้างเคียง** [Active-Passive Failover](../active-passive-failover/) ใช้ไอเดียเดียวกันกับทั้ง region โดยมีการตรวจจับ การ promote และการ fence primary ตัวเก่าของมันเอง [Health Endpoint Monitoring](../health-endpoint-monitoring/) คือวิธีที่ load balancer กับ orchestrator ตัดสิน instance แต่การผ่าน health check ไม่ได้ทำให้ instance เป็น leader ส่วน message relay ของ [Transactional Outbox](../transactional-outbox/) เป็นกรณีที่เจอบ่อยว่าต้องมี instance active ตัวเดียว เมื่อ event ของแต่ละ key ต้อง publish ตามลำดับ
