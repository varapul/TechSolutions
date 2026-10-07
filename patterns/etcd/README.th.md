## ปัญหา

Acme Shop รันอยู่บน Kubernetes และ Kubernetes ก็คือ control loop อิสระจำนวนมากที่ทำงานพร้อมกัน: scheduler วาง pod, controller คุมให้ Deployment กับ ReplicaSet มีขนาดถูกต้อง ส่วน kubelet ก็ start container พวกมันประสานงานกันผ่านบันทึกกลางชุดเดียว ที่บอกว่าอะไรควรมีอยู่และอะไรมีอยู่จริง บันทึกนี้ต้องถูกต้องแบบเข้มงวดจริง ๆ ถ้า scheduler สองตัวต่างเชื่อว่าตัวเองเป็นคนคุม หรือ controller ไปทำงานตาม Deployment ที่ถูกแทนที่ไปแล้ว cluster ก็จะวาง pod ซ้ำสองครั้ง หรือย้อน rollout กลับ บันทึกนี้ยังต้องอยู่รอดได้แม้เสียเครื่องไปหนึ่งเครื่องหรือเสียทั้ง Availability Zone และต้องบอก loop ต่าง ๆ ได้เมื่อมีอะไรเปลี่ยน เพราะจะอ่าน object เป็นพันตัวใหม่ทุกวินาทีไม่ได้

**etcd** เป็นคนเก็บบันทึกนี้ มันเป็น key-value store ขนาดเล็กที่ member ทุกตัว replicate การเขียนทุกครั้งด้วย consensus protocol ชื่อ **Raft**: การเขียนจะได้ acknowledge ก็ต่อเมื่อ member เสียงข้างมากเก็บมันไว้แล้ว และ member ทุกตัว apply การเขียนชุดเดียวกันตามลำดับเดียวกัน ทำให้ member ไม่มีวันเห็นไม่ตรงกันว่าเขียนอะไรลงไป นอกจากนั้นมันยังมีเครื่องมือที่งานประสานงานต้องใช้: **revision** ที่เรียงลำดับทุกการเปลี่ยนแปลง, **watch** ที่ stream การเปลี่ยนแปลงตั้งแต่ revision ล่าสุด ๆ ตัวไหนก็ได้, **transaction** ที่เปรียบเทียบก่อนเขียน และ **lease** ที่ทำให้ key หายไปพร้อมกับ client ที่เขียนมัน Kubernetes เก็บ object ทุกตัวไว้ในนี้ ส่วนระบบอื่นใช้มันเก็บ configuration, ทำ service discovery, lock และ leader election

## ทำงานยังไง

### Raft: leader, term และ log ที่ replicate กัน

etcd cluster คือชุด **member** ที่ตายตัว ปกติมีสามหรือห้าตัว และรู้ address ของกันและกัน member ตัวหนึ่งเป็น **leader** ส่วนตัวอื่นเป็น **follower** เวลาถูกแบ่งเป็น **term** ที่มีเลขกำกับ แต่ละ term เริ่มด้วยการเลือกตั้งและมี leader ได้ไม่เกินหนึ่งตัว ส่วนการเปลี่ยนแปลงแต่ละครั้งคือ entry หนึ่งตัวใน **log** ที่ replicate กัน ระบุด้วย index ของมันและ term ของ leader ที่สร้างมัน: ใน animation คือ entry 52340 ของ term 7

การเขียนหนึ่งครั้งเดินตามทางของ step 2:

1. client ส่งมันไปที่ member ตัวไหนก็ได้ follower จะส่ง request ที่ต้องใช้ consensus ต่อไปให้ leader ส่วน FAQ บอกว่า client ไม่ต้องรู้ว่า member ตัวไหนเป็น leader
2. leader ต่อ entry ท้าย log ของตัวเอง เขียนลง write-ahead log บน disk แล้วส่งไปให้ follower
3. follower แต่ละตัวเขียน entry ลง disk แล้ว acknowledge
4. พอ member **เสียงข้างมาก** รวม leader ด้วย มี entry นี้บน disk แล้ว มันก็ **committed** และจะไม่หายอีก ถึง leader จะพังในอีกอึดใจต่อมาก็ตาม ถ้ามีสาม member เสียงข้างมากคือสองตัว ทำให้ member ที่ช้าตัวเดียวไม่มีทางถ่วงการเขียน
5. member ทุกตัว **apply** entry ที่ committed แล้วลงสำเนา key-value store ของตัวเองตามลำดับใน log แล้ว leader ก็ตอบ client ส่วน follower รู้ commit index ใหม่จาก message ถัดไปของ leader จะเป็น append หรือ heartbeat ก็ได้

leader ส่ง heartbeat ทุก **100 ms** โดย default (`--heartbeat-interval`) ถ้า follower ไม่ได้ยินอะไรเลยนานเท่ากับ **election timeout** ของมัน (default **1,000 ms**, `--election-timeout`) มันจะกลายเป็น **candidate**: เริ่ม term ใหม่แล้วขอโหวตจากตัวอื่น ตัว Raft library ของ etcd สุ่ม timeout ให้อยู่ระหว่างหนึ่งถึงสองเท่าของค่าที่ตั้งไว้ ทำให้ follower แทบไม่เคยเริ่มเลือกตั้งพร้อมกัน member แต่ละตัวโหวตได้ครั้งเดียวต่อ term และโหวตให้แค่ candidate ที่ log ครบอย่างน้อยเท่าของตัวเอง ผู้ชนะเลยมี entry ที่ committed แล้วครบทุกตัว จากนั้นมันจะต่อ entry ว่างหนึ่งตัวใน term ใหม่ของตัวเอง (52373 ใน step 4) ทำให้มัน commit อะไรก็ตามที่ term ก่อน ๆ ค้างไว้ได้ etcd ยังรัน **pre-vote** ของ Raft โดย default ด้วย (`--pre-vote=true`): ตัวที่อยากเป็น candidate ต้องเช็กก่อนว่าตัวเองชนะได้ ทำให้ member ที่เคยถูก network partition ตัดขาดไม่มาป่วน cluster ที่ทำงานดีอยู่ด้วย term ที่สูงกว่าตอนมันกลับมา ส่วน tuning guide แนะนำให้ตั้ง heartbeat interval ใกล้ ๆ กับ round-trip time ระหว่าง member และตั้ง election timeout อย่างน้อยสิบเท่าของ round trip นั้น

cluster รับการเขียนได้ตราบใดที่ member เสียงข้างมากยังทำงานอยู่ ขนาดของ cluster เลยเป็นเลขคี่:

| Members | Majority | Failures tolerated |
|---|---|---|
| 1 | 1 | 0 |
| 3 | 2 | 1 |
| 5 | 3 | 2 |
| 7 | 4 | 3 |

member ตัวที่สี่ทำให้เสียงข้างมากขึ้นเป็นสาม แต่ไม่ได้ทำให้รอดจากการพังครั้งที่สอง และ member ทุกตัวที่เพิ่มเข้ามาก็ทำให้การเขียนแต่ละครั้งต้องรอ acknowledgement มากขึ้น etcd FAQ แนะนำให้มีไม่เกินเจ็ด member และมองว่าห้าตัวที่รอดจากการพังได้สองตัวก็พอในกรณีส่วนใหญ่ ส่วนเอกสารของ Kubernetes แนะนำ cluster ห้า member ใน production และไม่แนะนำให้ autoscale etcd ส่วน member ใหม่เข้ามาเป็น **learner** ที่ไม่มีสิทธิ์โหวตได้ (`etcdctl member add --learner`) แล้ว copy ข้อมูล แล้วค่อย promote ด้วย `etcdctl member promote` เมื่อตามทันแล้ว ทำให้มันไม่ถูกนับเข้าเสียงข้างมากก่อนที่จะช่วยอะไรได้

Raft ถูกเสนอโดย Diego Ongaro และ John Ousterhout ใน *In Search of an Understandable Consensus Algorithm* (USENIX ATC 2014) ตัว implementation ของ etcd คือ Go library `go.etcd.io/raft` ที่ CockroachDB fork ไปทำโค้ด Raft ของตัวเอง ส่วน KRaft controller ของ [Kafka](../kafka/) replicate metadata ของ cluster ด้วย protocol ที่ใช้ Raft เป็นฐาน และ replica set ของ [MongoDB](../mongodb/) ก็เลือก primary ด้วยเสียงข้างมากเหมือนกัน

### Revision และ store แบบหลายเวอร์ชัน

key space แบนและเรียงลำดับ: key เป็น byte string และสิ่งที่ดูเหมือน directory อย่าง `/registry/deployments/` ก็แค่ prefix ที่ range หรือ watch ครอบได้ การเปลี่ยนแปลง key space ทุกครั้ง ไม่ว่าจะเป็น put, delete หรือทั้ง transaction จะเพิ่มค่า counter 64-bit ตัวเดียวของทั้ง cluster ที่เรียกว่า **revision** ตัวนี้ทำหน้าที่เป็น logical clock: revision 41872 มาหลัง 41871 บนทุก member ตัว store เป็นแบบ **multi-version** (MVCC): การอัปเดตจะเพิ่มเวอร์ชันใหม่แทนที่จะเขียนทับของเก่า ทำให้การอ่านขอดู key space ตามสภาพที่ revision ก่อนหน้าได้

key แต่ละตัวมีตัวเลขสามตัว:

- `create_revision` คือ revision ที่ key ถูกสร้างครั้งล่าสุด
- `mod_revision` คือ revision ของการเปลี่ยนแปลงครั้งล่าสุด (41872 สำหรับ Deployment ของ catalog หลัง step 2)
- `version` คือจำนวนครั้งที่เปลี่ยนนับตั้งแต่สร้าง ถ้าลบแล้วจะ reset เป็นศูนย์

บน disk member แต่ละตัวเก็บเวอร์ชันต่าง ๆ ไว้ในไฟล์ B+tree (bbolt) และมี index ใน memory ที่ map จาก key ไป revision เวอร์ชันเก่าจะอยู่จนกว่า **compaction** จะทิ้งทุกอย่างที่ถูกแทนที่ไปแล้วก่อน revision ที่กำหนด หลังจากนั้นการอ่านหรือ watch ที่ revision เก่ากว่าจะล้มเหลวด้วย `required revision has been compacted` ตัว compaction คืนพื้นที่ภายในไฟล์ database ส่วน **defragmentation** คืนพื้นที่นั้นให้ file system

Kubernetes สร้าง optimistic concurrency ของมันบนตัวเลขพวกนี้ ตัว kube-apiserver เก็บ object แต่ละตัวไว้ใต้ `/registry/<resource>/<namespace>/<name>` (prefix มาจาก `--etcd-prefix` โดย default คือ `/registry`) และในโค้ด storage ที่คุยกับ etcd ค่า `resourceVersion` ของ object ก็คือ `mod_revision` ของ key มัน

### การอ่านแบบ linearizable และ serializable

โดย default การอ่านเป็นแบบ **linearizable**: มันเห็นทุกการเขียนที่เสร็จก่อนการอ่านเริ่ม etcd ทำแบบนี้ได้โดยไม่ต้องใส่การอ่านลง log ตัว member ที่ตอบการอ่านจะขอ commit index จาก leader แล้ว leader ก็ยืนยันว่าตัวเองยังเป็น leader อยู่ด้วยการแลก heartbeat กับเสียงข้างมาก (ReadIndex ของ Raft) จากนั้น member ก็ตอบเมื่อ apply ทุกอย่างจนถึง index นั้นแล้ว ส่วนการอ่านแบบ **serializable** (`etcdctl get --consistency=s`) ข้ามรอบนี้ไปแล้วตอบจาก store ของ member เอง: มันเร็วกว่า และยังใช้ได้ตอนที่ cluster เสียเสียงข้างมากไปแล้ว แต่อาจได้ข้อมูลเก่า

### Watch

**watch** คือการ subscribe key หรือ prefix แล้วรับการเปลี่ยนแปลงแต่ละครั้งเป็น event คือ `PUT` ที่มี key-value ใหม่ หรือ `DELETE` ตามลำดับ revision ตัว API guarantee บอกว่า event มาถึงตามลำดับ ไม่มีวันซ้ำ event ทั้งหมดของ revision เดียวมาด้วยกัน และไม่มีช่องว่างภายในประวัติที่ยังเก็บไว้ watch เริ่มที่ revision ในอดีตได้ ทำให้ client ที่จำ revision สุดท้ายที่เห็นไว้ reconnect ได้ แม้จะเป็น member ตัวอื่น แล้วต่อจากจุดที่หยุดไว้ได้พอดี ตราบใดที่ประวัติช่วงนั้นยังไม่ถูก compact

นี่คือวิธีที่ controller ทุกตัวของ Kubernetes เลี่ยงการ poll ตัว kube-apiserver list resource หนึ่ง แล้ว watch prefix ของมันตั้งแต่ revision ของการ list นั้น และเก็บผลไว้ใน **watch cache** ของตัวเอง ตัว cache นี้ตอบ request list และ watch ของ controller, scheduler และ kubelet จาก memory ทำให้ etcd เห็น watch แค่หนึ่งตัวต่อ resource จาก API server แต่ละตัว แทนที่จะเป็นหนึ่งตัวต่อ client ตัว API server ยัง compact etcd ทุก 5 นาทีโดย default ด้วย (`--etcd-compaction-interval`) และเอกสารของ Kubernetes บอกว่า cluster เก็บประวัติการเปลี่ยนแปลงไว้ประมาณ 5 นาที: client ที่ watch ตามหลังเกินกว่านั้นจะได้ `410 Gone` แล้วต้อง list ใหม่

```sh
# Acme's own etcd cluster for its services, not the Kubernetes one
export ETCDCTL_ENDPOINTS=https://etcd-a:2379,https://etcd-b:2379,https://etcd-c:2379
etcdctl endpoint status --cluster -w table           # leader, Raft term and index, database size per member
etcdctl get --prefix /acme/config/                   # linearizable read (the default)
etcdctl get --prefix --consistency=s /acme/config/   # serializable: local, possibly stale
etcdctl get --prefix --rev=9120 /acme/config/        # the keys as they were at revision 9120
etcdctl watch --prefix --rev=9121 /acme/config/      # every change after 9120, then the live ones
```

### Transaction

**transaction** (`Txn`) คือ *if, then, else* แบบ atomic: มีรายการการเปรียบเทียบบน key (value ของ key, `version`, `create_revision`, `mod_revision` หรือ lease) มีรายการ operation ที่จะรันถ้าการเปรียบเทียบผ่านทุกข้อ และอีกรายการที่จะรันถ้าไม่ผ่าน มันเป็น Raft entry ตัวเดียว และถ้ามันเปลี่ยนอะไรก็จะเป็น revision เดียว รูปแบบสองแบบครอบคลุมการใช้งานเกือบทั้งหมด:

- **Create if absent**: เปรียบเทียบ `create_revision = 0` แปลว่ายังไม่มี key นี้ แล้วค่อย put ถ้ามี client หลายตัวแข่งกัน จะมีตัวเดียวพอดีที่สำเร็จ
- **Compare and swap**: เปรียบเทียบ `mod_revision` กับ revision ที่อ่านมาก่อนหน้า แล้วค่อย put ถ้ามีคนเขียนตัวอื่นมาถึงก่อน การเปรียบเทียบจะไม่ผ่าน แล้ว client ก็อ่านใหม่แล้ว retry

kube-apiserver ใช้ทั้งสองแบบ: มันสร้าง object ด้วย create-if-absent ส่วนการ update และ delete จะเปรียบเทียบ `mod_revision` ใน step 2 ตัว API server เขียน Deployment ของ catalog ด้วย "if `mod_revision` = 41250, then put" และใน step 3 การอัปเดต Lease ของ scheduler-b ก็กลายเป็น "if `mod_revision` = 41880, then put" ส่วน client ที่ส่ง update มาพร้อม `resourceVersion` ที่เก่าแล้วจะได้ `409 Conflict` แทนที่จะเขียนทับการเปลี่ยนแปลงของคนอื่นไปเงียบ ๆ

### Lease

**lease** คือ timer ที่ cluster ถือไว้แทน client ตัว client ขอ lease พร้อม time to live (TTL) ผูก key เข้ากับมัน แล้ว renew ด้วย **keepalive** โดย Go client จะส่งทุกหนึ่งในสามของ TTL ถ้า keepalive หยุดนานเกิน TTL ตัว lease ก็หมดอายุ etcd จะลบทุก key ที่ผูกกับมัน แล้วการลบแต่ละครั้งก็ไปถึงตัวที่ watch อยู่เป็น event `DELETE` ส่วนตัว lease เองไม่ได้ผูกกับ connection ทำให้ client สลับ member ได้โดยยังถือมันไว้ และ leader ที่เพิ่งได้รับเลือกจะยืดทุก lease ตอนรับตำแหน่ง ทำให้ lease ไม่หมดอายุเพราะการเลือกตั้งของ cluster เอง

Kubernetes ผูก **Event** กับ lease ของ etcd เพราะแบบนี้ Event ถึงหายไปหลัง `--event-ttl` (default 1 ชั่วโมง) ส่วน **Lease object** ใน API `coordination.k8s.io` เป็นคนละเรื่องกัน: มันเป็น key ธรรมดาที่ตัวที่ถือมันเขียนทับเพื่อ renew ใช้กับ heartbeat ของ node และ leader election ของ kube-scheduler กับ kube-controller-manager ตัว standby จะรับช่วงต่อเมื่อไม่เห็นการ renew เลยนาน `leaseDurationSeconds` โดยสำหรับ kube-scheduler ค่า default คือ 15 s (`--leader-elect-lease-duration` โดย renew ทุก 2 s) และนี่ก็คือการรับช่วงใน step 3

### Lock และ leader election

lease, transaction และ watch รวมกันเป็นสูตรการประสานงานที่ etcd ขึ้นชื่อ client ที่อยากเป็น leader จะ:

1. ขอ lease มาหนึ่งตัว ที่นี่คือ 15 s แล้วคอยต่ออายุมันไว้
2. สร้าง key ของ leader ใน transaction ที่สำเร็จก็ต่อเมื่อยังไม่มี key นี้ โดยผูกไว้กับ lease ของตัวเอง
3. ถ้า transaction ไม่ผ่าน ก็ watch key นั้นแล้วลองใหม่เมื่อมันถูกลบ

เมื่อ leader ตาย keepalive ของมันก็หยุด lease หมดอายุ etcd ลบ key แล้ว candidate ที่รออยู่ก็เห็น `DELETE` และ transaction ถัดไปก็ชนะ:

```sh
etcdctl lease grant 15
# lease 694d71ddacfda227 granted with TTL(15s)

etcdctl txn <<'EOF'
create("/acme/report-runner/leader") = "0"

put --lease=694d71ddacfda227 /acme/report-runner/leader runner-a

get /acme/report-runner/leader

EOF
# SUCCESS: runner-a leads (a candidate that loses sees FAILURE and the current leader's value)

etcdctl lease keep-alive 694d71ddacfda227   # keeps runner-a's lease, and its key, alive
etcdctl watch /acme/report-runner/leader     # what the other candidates wait on
```

etcd ห่อ pattern นี้ไว้ใน election service และ lock service ของมัน (`etcdctl elect`, `etcdctl lock` และ Go package `concurrency`) ในนั้น candidate แต่ละตัวสร้าง key ของตัวเองใต้ prefix ที่ใช้ร่วมกัน ผูกกับ session lease (default 60 s ใน Go package และ `etcdctl elect` ส่วน `etcdctl lock` คือ 10 s) แล้ว key ที่มี `create_revision` ต่ำที่สุดก็เป็น leader ทำให้ candidate ต่อคิวกันตามลำดับ แทนที่จะ retry พร้อมกันหมด

lease อย่างเดียวรับประกัน mutual exclusion ไม่ได้ leader อาจค้างไปตอนติด garbage-collection pause นาน ๆ หรือ disk ช้า จนเลยเวลาที่ lease หมดอายุ แล้วก็ทำงานต่อเหมือนยังเป็น leader อยู่ บันทึกเรื่อง lock ของ etcd ชี้ไปที่ revision ของ key ว่าเป็น **fencing token** ที่ resource ที่ถูกป้องกันควรเช็ก เป็นแนวคิดที่ Martin Kleppmann อธิบายไว้ใน *How to do distributed locking* โดยที่ `etcdctl lock` ส่ง revision นั้นให้คำสั่งที่มันรันในชื่อ `ETCD_LOCK_REV` ส่วน [Leader election](../leader-election/) เล่าเรื่องทั้งหมดนี้ และ lock ของ [Redis](../redis/) ก็เลือกแลกไปอีกทาง: primary ตัวเดียวกับ replication แบบ asynchronous ที่เร็วกว่าแต่รับประกันได้น้อยกว่า

### Disk, network และขนาด

การเขียนทุกครั้งต้องรอจน member เสียงข้างมากเขียนมันลง disk ด้วย `fsync` แล้ว **latency ของการเขียน disk** เลยมักเป็นตัวกำหนดความเร็วของ etcd ตัว hardware guide ขอประมาณ 50 sequential IOPS สำหรับ cluster ที่งานเบา และ 500 สำหรับ cluster ที่งานหนัก แนะนำให้ใช้ SSD และบอกว่า cluster ทั่วไปต้องการ CPU สองถึงสี่ core กับ memory ประมาณ 8 GB ถ้า disk ช้าหรือใช้ร่วมกับคนอื่น leader อาจส่ง heartbeat ไม่ทัน แล้ว follower ก็แยกไม่ออกว่าต่างจากการพังยังไง ผลคือเสีย leader election ไปหนึ่งรอบ โดยที่ FAQ อธิบายว่าทำไมถึงตั้งใจออกแบบแบบนั้น network ก็เพิ่ม round trip ให้การเขียนทุกครั้ง: member ที่อยู่ใน Availability Zone ต่าง ๆ ของ region เดียวกันทำงานได้ดี แต่ member ที่อยู่ต่าง region ต้องใช้ timeout ที่นานกว่ามาก (election timeout ตั้งได้ถึง 50 s) และต้องจ่าย latency นั้นในทุกการเขียน

etcd เก็บ metadata ไม่ใช่ข้อมูลก้อนใหญ่ request หนึ่งใหญ่ได้ไม่เกิน 1.5 MiB (`--max-request-bytes`) และ database จำกัดไว้ที่ 2 GiB โดย default (`--quota-backend-bytes`) โดยแนะนำให้ไม่เกิน 8 GiB เมื่อ member ตัวไหนเกิน quota ตัว etcd จะยก alarm `NOSPACE` แล้วทั้ง cluster ก็จะรับแค่การอ่านและการลบ จนกว่าจะคืนพื้นที่ ทำ defragment database และเคลียร์ alarm ด้วย `etcdctl alarm disarm` ส่วน Kubernetes กระจายข้อมูลไปไว้บนหลาย etcd cluster ได้ด้วย `--etcd-servers-overrides` เช่นแยก Event ออกไปไว้ต่างหาก

### Security

etcd ฟังอยู่สอง port: **2379** สำหรับ client และ **2380** สำหรับ member ตัวอื่น ทั้งคู่ควรใช้ TLS กับ client certificate: `--cert-file`, `--key-file`, `--trusted-ca-file` และ `--client-cert-auth` สำหรับ client และใช้ flag ชุดเดียวกันแบบ `--peer-*` ระหว่าง member นอกจาก TLS แล้ว etcd ยังมี user และ role ที่มีสิทธิ์บน key หรือ prefix (`etcdctl role grant-permission acme-config --prefix=true readwrite /acme/config/` แล้วตามด้วย `etcdctl auth enable`) และระบุตัว user ได้ด้วย common name ของ client certificate ของมัน สำหรับ Kubernetes การเข้าถึง etcd ได้ก็เท่ากับคุม cluster ได้ทั้งหมด เอกสารเลยแนะนำให้มีแค่ API server ที่เข้าถึงมันได้ และ API server ควร encrypt Secret ก่อนเก็บด้วย เพราะโดย default มันเขียนทุก resource ลง etcd เป็น plain text

### Backup, membership และการ upgrade

`etcdctl snapshot save` เขียนสำเนา ณ จุดเวลาหนึ่งของ database ของ member ตัวหนึ่ง แล้ว `etcdutl snapshot restore` ก็สร้าง data directory ใหม่จากมัน member ทุกตัวของ cluster ที่ restore ต้องเริ่มจาก snapshot เดียวกัน การ restore ทำให้ revision ถอยกลับไปเท่ากับของ snapshot แล้วทำให้ client ที่เคยเห็น revision ที่ใหม่กว่างง สำหรับ Kubernetes ตัว disaster-recovery guide เลยแนะนำให้ restore ด้วย `--bump-revision` และ `--mark-compacted`: revision จะยังเพิ่มขึ้นต่อไป และ watch ที่มีอยู่ทุกตัวจะถูกยกเลิก

การเปลี่ยน membership ก็ต้องผ่าน Raft เหมือนกัน ถ้าจะแทน member ที่พัง ให้เอามันออกก่อนแล้วค่อยเพิ่มตัวใหม่ และควรเพิ่มเป็น learner: ถ้าเพิ่มก่อน เสียงข้างมากจะสูงขึ้นในขณะที่ cluster ยังพึ่งตัวใหม่ไม่ได้ การ upgrade เป็นแบบ rolling ทีละ member และทีละ minor version ถ้าจะไป 3.7 ทุก member ต้องรัน 3.6.11 หรือใหม่กว่า ให้ทำ snapshot ก่อน: พอ member ทุกตัวรันเวอร์ชันใหม่แล้ว ทางกลับมีแค่ snapshot นั้น หรือขั้นตอน downgrade ที่มีในเอกสาร

### เวอร์ชันและ licence

etcd เป็นโปรเจกต์ของ Cloud Native Computing Foundation ที่ graduate ในเดือนพฤศจิกายน 2020 และใช้ Apache License 2.0 สายปัจจุบันคือ **3.7**: 3.7.0 ออกเมื่อ 8 กรกฎาคม 2026 และ 3.7.2 ออกเมื่อ 22 กันยายน 2026 วันเดียวกับ patch release 3.6.15 และ 3.5.34 ของสายเก่า เวอร์ชัน 3.7 เอาโค้ด v2 ที่เหลือและ experimental flag ที่ deprecated ออก เพิ่ม `RangeStream` สำหรับอ่าน range ขนาดใหญ่เป็นช่วง ๆ และทำให้ operation ของ lease กับการอ่านแบบเอาแค่ key เร็วขึ้น ใน Kubernetes 1.37 ตัว kubeadm ติดตั้ง etcd 3.7.0 และ API server อ่าน list ขนาดใหญ่จาก etcd 3.7 เป็น stream เมื่อเปิด feature gate `EtcdRangeStream` (beta และเปิดอยู่โดย default)

## อยู่ตรงไหนใน solution

- **Solution** เป็น backing store ของ Kubernetes cluster ทุกตัว ([Kubernetes](../kubernetes/)): Deployment, Pod, Secret, Lease และ custom resource ทั้งหมดอยู่ใน etcd หลัง kube-apiserver นอก Kubernetes ก็มี Patroni ที่ทำ high availability ให้ [PostgreSQL](../postgresql/) โดยใช้ etcd, ZooKeeper หรือ Consul เป็น coordination store ตัว plugin `etcd` ของ CoreDNS ที่ตอบ DNS record จาก etcd เพื่อทำ service discovery และ Apache APISIX ที่เก็บ route กับ configuration ไว้ใน etcd
- **Pattern ที่มัน implement หรือช่วยรองรับ** [Leader election](../leader-election/) ด้วย lease และ transaction, distributed lock ที่ fence ด้วย revision, [external configuration store](../external-configuration-store/) ที่ service คอย watch แทนการ poll, service discovery ที่การลงทะเบียนหมดอายุไปพร้อม lease และ control loop ที่ขับด้วย watch ของ [Kubernetes](../kubernetes/)
- **เพื่อนบ้านที่มักเจอ** ใน Kubernetes คือ kube-apiserver ที่เป็น client ตัวเดียวของมัน ที่อื่นก็มี client library ที่คุยผ่าน gRPC API ของมัน, [Prometheus](../prometheus/) ที่ scrape metric ของแต่ละ member (`etcd_server_has_leader`, `etcd_server_leader_changes_seen_total`, `etcd_disk_wal_fsync_duration_seconds`, `etcd_mvcc_db_total_size_in_use_in_bytes`) และ job ตามตารางเวลาที่ทำ snapshot
- **Managed offering (ตุลาคม 2026)** ปกติ etcd มาอยู่ข้างใน control plane ของ Kubernetes แบบ managed ไม่ได้มาเป็น service แยกของตัวเอง **Amazon EKS** รัน API server อย่างน้อยสอง instance และ etcd สาม instance กระจายอยู่สาม Availability Zone ต่อ cluster และรายงานการใช้ database ใน [CloudWatch](../amazon-cloudwatch/) (`etcd_mvcc_db_total_size_in_use_in_bytes`) ถ้าเกิน quota ตัว cluster จะกลายเป็น read-only สำหรับ cluster ขนาด ultra-scale (ได้ถึง 100,000 node ประกาศเมื่อกรกฎาคม 2025) AWS อธิบายว่าเอา internal journal service มาแทน Raft replication ของ etcd เก็บ database bbolt ไว้ใน memory และแยก resource type ไปไว้ต่าง etcd cluster การเปลี่ยนแปลงพวกนี้ใช้กับ cluster ใหม่ที่สร้างโดยเปิด ultra-scale เท่านั้น **Azure AKS** ระบุว่า etcd เป็นหนึ่งใน control-plane component ที่ Azure ดูแลให้ ทั้งใน AKS Automatic และ AKS Standard **Google GKE** เก็บ state ของ cluster ไว้ใน etcd บน control-plane VM ทุกตัว หรือไม่ก็ใน Spanner และไม่ว่าแบบไหนก็ให้ etcd API กับ API server ส่วนนอก Kubernetes คุณต้องรัน etcd เอง บน virtual machine หรือใน cluster ของมันเอง

## ใช้ตอนไหนดี

เลือก etcd เมื่อกลุ่ม service ต้องการ shared state ปริมาณน้อยที่ต้อง **ถูกต้อง** ไม่ใช่แค่เร็ว: configuration ที่ทุก instance ต้องอ่านได้ตรงกัน, membership และ service discovery ที่ entry หายไปเมื่อเจ้าของตาย, lock, leader election และอะไรก็ตามที่ต้องไม่มีวันแสดงค่าสองค่าที่ต่างกันให้คนอ่านสองคน มันเหมาะกับ metadata หลัก megabyte ที่เปลี่ยนตามจังหวะของการตัดสินใจฝั่ง control ไม่ใช่ข้อมูลผู้ใช้ที่เขียนตามจังหวะ traffic ของผู้ใช้ ถ้าเป็นข้อมูลก้อนใหญ่ให้ใช้ database ส่วน cache กับ lock อายุสั้นที่ความเร็วสำคัญกว่าการรับประกันแบบเข้มงวด ตัวเลือกปกติคือ [Redis](../redis/) ส่วน Apache ZooKeeper แก้ปัญหาเดียวกันด้วย tree ของ znode และ ephemeral node ที่ผูกกับ session ของ client ตัว Kafka เองก็พึ่งมันมาตลอดจน KRaft มาแทนใน Kafka 4.0 ส่วน HashiCorp Consul เป็น product ด้าน service networking เป็นหลัก โดยมี key/value store อยู่ข้าง service catalog, health check และ DNS ของมัน เอกสารของ etcd มีตารางเปรียบเทียบของตัวเอง ที่อย่างที่มันบอกเองว่าเขียนโดยทีม etcd ส่วนตารางข้างล่างยึดแค่สิ่งที่แต่ละโปรเจกต์เขียนไว้ในเอกสารของตัวเอง

| | etcd | Apache ZooKeeper | HashiCorp Consul |
|---|---|---|---|
| Replication | Raft | Zab คือ atomic broadcast protocol ของ ZooKeeper | Raft ระหว่าง server และใช้ Serf gossip สำหรับ membership กับการตรวจจับการพัง |
| Data model | key space แบนที่เรียงลำดับ และทุก key มีเวอร์ชัน (MVCC) | tree ของ znode ที่แต่ละตัวมีข้อมูล (ไม่เกิน 1 MB) และ children | key/value store (value ใหญ่ได้ถึง 512 KB) อยู่ข้าง service catalog ที่มี health check และ DNS |
| Reads | linearizable โดย default และขอแบบ serializable ได้ | server ที่ต่ออยู่เป็นคนตอบ และอาจได้ข้อมูลเก่า ส่วน `sync` จะตามให้ทันก่อน | มีโหมด `default`, `consistent` และ `stale` โดย DNS ใช้ `stale` เป็น default |
| Change notification | watch บน key หรือ prefix เริ่มจาก revision ไหนก็ได้ที่ยังเก็บอยู่ | watch แบบใช้ครั้งเดียว และมี watch แบบ persistent กับ recursive ตั้งแต่ 3.6 | blocking query (long polling) |
| Liveness | lease ที่มี TTL และ keepalive แล้ว key ถูกลบเมื่อหมดอายุ | ephemeral znode ที่ถูกลบเมื่อ session จบ | session ที่ผูกกับ health check หรือ TTL โดยมี lock-delay (default 15 s) ก่อนที่ lock จะถูกเอาไปใหม่ได้ |
| Locks and election | transaction และ election กับ lock service | สูตรที่ใช้ sequential ephemeral znode | session บน KV key และ `consul lock` |
| Licence | Apache 2.0 (CNCF) | Apache 2.0 (Apache Software Foundation) | Business Source License 1.1 ตั้งแต่ 1.17 (IBM) |
| Current release | 3.7.2 | 3.9.6 เป็นตัวปัจจุบัน และ 3.8.7 เป็นตัว stable | 2.0.4 |

ตัวเลขจากเอกสารและ release ของแต่ละโปรเจกต์ ตุลาคม 2026

## ได้อะไร เสียอะไร

- **ความถูกต้องแลกมาด้วย latency และ availability** การเขียนทุกครั้งต้องรอ disk ของเสียงข้างมาก และถ้าไม่มีเสียงข้างมาก cluster ก็หยุดรับการเขียนและการอ่านแบบ linearizable นี่คือการแลกที่ตั้งใจไว้: etcd ยอมไม่ตอบ ดีกว่าตอบผิด
- **มัน scale out ไม่ได้** member ทุกตัวถือข้อมูลทั้งหมด และ leader เป็นคนเรียงลำดับทุกการเขียน ทำให้ member ที่เพิ่มขึ้นเพิ่มแค่ fault tolerance ไม่ได้เพิ่ม capacity และยังทำให้การเขียนช้าลง ข้อมูลต้องพอดีกับ quota ส่วนระบบที่ใหญ่กว่าจะแบ่งข้อมูลไปไว้หลาย cluster แยกกัน
- **ประวัติต้องคอยเก็บกวาด** MVCC เก็บทุกเวอร์ชันไว้จนกว่าจะ compact และ compaction ทิ้ง page ว่างไว้ที่มีแค่ defragmentation คืนให้ file system ได้ และระหว่างที่มันรัน member จะถูก block
- **ไวต่อ disk ที่ช้า** member ที่ fsync ไม่ทันจะส่ง heartbeat ไม่ทันและดูเหมือนพัง ทำให้เสีย leader election ไป hardware guide บอกว่า disk ที่เร็วเป็นปัจจัยที่สำคัญที่สุด และน้อย deployment ที่ต้องใช้ CPU เยอะ
- **lease อย่างเดียวไม่ใช่ lock** leader ที่ค้างไปอาจทำงานหลัง lease หมดอายุแล้ว resource ที่อยู่นอก etcd เลยต้องมี fencing token เช่น revision ของ key ไว้ปฏิเสธมัน
- **เป็นงาน operation อีกงานหนึ่งของมันเอง** ทั้ง snapshot, defragmentation, การหมุน certificate, การเปลี่ยน membership และการ upgrade ทีละ minor version ล้วนต้องใช้ความระวัง ส่วน Kubernetes แบบ managed รับงานทั้งหมดนั้นไปให้ สำหรับ etcd ของ cluster เอง

## ข้อควรรู้ตอนลงมือทำ

- **รันสามหรือห้า member** หนึ่งตัวต่อ failure domain เช่น Availability Zone บน SSD ที่มี link ระหว่างกันแบบ latency ต่ำ บนเครื่องเฉพาะ หรืออย่างน้อยก็ห่างจากเพื่อนบ้านที่กิน disk หนัก ตามที่ guide ของ Kubernetes แนะนำ
- **ปรับ timeout ให้เข้ากับ network**: heartbeat interval ใกล้ ๆ กับ round-trip time ระหว่าง member และ election timeout อย่างน้อยสิบเท่าของค่านั้น และตั้งเหมือนกันทุก member
- **คอยดูสัญญาณสุขภาพ**: member แต่ละตัวมี leader ไหม leader เปลี่ยนบ่อยแค่ไหน ระยะเวลาของ WAL fsync และ backend commit และขนาด database เทียบกับ quota ส่วน FAQ บอกว่าการ apply request หนึ่งปกติควรใช้ไม่ถึง 50 ms และ etcd จะเตือนเมื่อค่าเฉลี่ยเกิน 100 ms
- **compact และ defragment ตามตารางเวลา** API server ของ Kubernetes compact ทุก 5 นาที ส่วนการใช้งานอื่นให้ตั้ง `--auto-compaction-retention` (ปิดอยู่โดย default) ให้ defragment ทีละ member ในช่วงที่เงียบ ๆ โดยที่ guide ของ Kubernetes ชี้ไปที่ `etcd-defrag` ที่รันเป็น CronJob ได้
- **ทำ snapshot และซ้อม restore** รวมถึง `--bump-revision` และ `--mark-compacted` สำหรับ Kubernetes ก่อนที่ incident จะบังคับให้ต้องทำ
- **เปลี่ยน membership ทีละ member**: เอา member ที่ตายออกก่อนเพิ่มตัวแทน และเพิ่มตัวใหม่เป็น learner
- **ป้องกันทั้งสอง port** ด้วย TLS และ client certificate ให้แค่ API server (หรือ service ของคุณเอง) เข้าถึง port 2379 ได้ และเปิด authentication ของ etcd สำหรับ client ที่ต่อตรง
- **ทำให้ key มีโครงสร้างและ value เล็ก**: prefix อย่าง `/acme/config/` ทำให้ watch และ permission ง่าย ส่วน blob ใหญ่ ๆ ให้เก็บใน object store และเก็บแค่ reference ของมันไว้ใน etcd
- **ใช้สูตรที่มีให้** (`concurrency.Election`, `concurrency.Mutex`, `etcdctl lock`) แทน lock ที่เขียนเอง และส่ง revision ของ key ต่อลงไปเป็น fencing token
