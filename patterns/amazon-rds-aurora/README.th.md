## ปัญหา

ในหน้า [PostgreSQL](../postgresql/) นั้น Acme Shop รัน database ของ order เอง ต้องมีคนกำหนดขนาดและ patch server คอยเตรียม hot standby และเครื่องมืออย่าง Patroni ไว้ promote มัน แล้วยังต้อง archive WAL ไปเก็บที่ object storage ทดสอบการ restore และวาง PgBouncer ไว้หน้า connection งานพวกนี้ไม่เกี่ยวกับ order เลย แต่ทุกอย่างต้องถูกต้องในคืนที่ disk พัง

relational database แบบ managed รับงานพวกนี้ไปทำแทน เราเลือก engine, ขนาด instance และ deployment option ส่วน AWS จัดเตรียม host, ติดตั้งและ patch engine, ทำ backup และจัดการ failover ให้ ส่วน schema, query, index, การจูน vacuum และการจัดการ connection ยังเป็นของเรา รวมถึงการเลือกระหว่างสองตระกูลในหน้านี้ด้วย:

- **Amazon RDS** รัน engine มาตรฐานบน DB instance โดยแต่ละตัวมี block storage ของตัวเอง สำหรับ PostgreSQL นั่นคือ community PostgreSQL ทำให้ `pg_dump` และ logical replication เอาข้อมูลออกไปได้อีก
- **Amazon Aurora** ใช้ engine ที่ compatible กับ MySQL หรือ PostgreSQL แต่เปลี่ยน storage ของมันเป็น distributed volume ที่ทุก instance ใน cluster ใช้ร่วมกัน และรันได้แค่บน AWS

## ทำงานยังไง

### อะไรที่ AWS รัน และอะไรที่ยังเป็นของเรา

**DB instance** คือ database server ที่ AWS ดูแลอยู่บน hardware ที่เราไม่เคยเห็น และวางอยู่ใน subnet ของ VPC ของเรา ตัว DB subnet group ต้องมี subnet ในอย่างน้อยสอง Availability Zone และ instance จะได้ DNS name อย่าง `orders-db.<id>.us-east-1.rds.amazonaws.com` ตัว RDS ไม่ให้ shell หรือสิทธิ์เข้า host และ block procedure กับ system table แบบ privileged บางตัว ส่วน RDS Custom ที่มีแค่สำหรับ Oracle และ SQL Server คือตัวที่ให้เข้าถึง operating system ได้

engine ณ ตุลาคม 2026: RDS รัน IBM Db2, MariaDB, Microsoft SQL Server, MySQL, Oracle Database และ PostgreSQL ส่วน Aurora มีให้เลือกสองรุ่น คือรุ่นที่ compatible กับ MySQL และรุ่นที่ compatible กับ PostgreSQL การ patch จะมาใน maintenance window รายสัปดาห์ และบน Multi-AZ deployment ตัว RDS จะลง update ของ operating system ให้ standby ก่อน แล้วค่อย fail over ไปที่มัน ทำให้ช่วงที่สะดุดนานประมาณ failover หนึ่งครั้ง

### Deployment option

| | Single-AZ DB instance | Multi-AZ DB instance | Multi-AZ DB cluster | Aurora DB cluster |
|---|---|---|---|---|
| Instance | หนึ่งตัว | primary และ standby หนึ่งตัวในอีก AZ | writer และ standby ที่อ่านได้สองตัว ในสาม AZ | writer หนึ่งตัวและ reader ได้ถึง 15 ตัว |
| Replication | ไม่มี มีแค่ backup | synchronous | semisynchronous: commit ต้องได้ acknowledgement จาก reader อย่างน้อยหนึ่งตัว | cluster volume ตัวเดียวที่ใช้ร่วมกัน หก copy ในสาม AZ |
| standby รับ read ไหม | — | ไม่ | รับ | รับ คือตัว reader |
| Failover | ไม่มี standby: volume หายก็ต้อง restore จาก backup | ปกติ 60–120 s | ปกติต่ำกว่า 35 s | ส่วนใหญ่ต่ำกว่า 60 s และบ่อยครั้งต่ำกว่า 30 s |
| Engine | ทุก engine ของ RDS | ทุก engine ของ RDS (SQL Server ใช้ mirroring หรือ Always On ของตัวเอง) | RDS for MySQL และ RDS for PostgreSQL | Aurora MySQL และ Aurora PostgreSQL |

diagram เปรียบเทียบคอลัมน์ที่สองกับคอลัมน์สุดท้าย

### Storage

RDS เก็บข้อมูลของแต่ละ instance บน EBS volume: General Purpose SSD (`gp2`, `gp3`) หรือ Provisioned IOPS SSD (`io1`, `io2` Block Express) ตัว instance ของ RDS for PostgreSQL เก็บได้ถึง 64 TiB และมีแค่ Oracle และ SQL Server ที่ไปถึง 256 TiB โดยใช้ storage volume เพิ่ม ส่วน magnetic storage เลิกใช้แล้ว (deprecated): instance ใหม่ใช้มันไม่ได้ RDS ย้าย magnetic volume ที่มีอยู่ไปเป็น `gp3` แล้ว และตั้งแต่ 1 กรกฎาคม 2026 ก็ restore snapshot ลงบนมันไม่ได้อีก ตัว storage autoscaling (`--max-allocated-storage`) ขยายขนาดที่จองไว้เมื่อพื้นที่ว่างเหลือน้อย จนถึงเพดานที่เราตั้ง ส่วน instance แบบ Multi-AZ เขียนทุกการเปลี่ยนแปลงสองครั้ง ทำให้ write I/O ของมันเป็นสองเท่า แต่ RDS ไม่คิดค่า replication traffic ระหว่าง primary กับ standby

Aurora ไม่มีขนาด volume ให้เลือก ตัว cluster volume โตตามข้อมูล ได้ถึง 128 TiB หรือ 256 TiB บน Aurora PostgreSQL 15.13, 16.9, 17.5 ขึ้นไป (และ Aurora MySQL 3.10 ขึ้นไป) และบน version ปัจจุบัน มันคืนพื้นที่เมื่อ table ถูก drop หรือ truncate การเพิ่ม instance ไม่ต้อง copy ข้อมูลเลย เพราะ instance ใหม่แค่ attach เข้ากับ volume ที่มีอยู่แล้ว

### Backup, snapshot และ point-in-time recovery

**Automated backup** ทำให้ database restore ได้ตลอด retention period 0 ถึง 35 วัน ค่า 0 คือปิด ส่วน Multi-AZ DB cluster ต้องตั้งอย่างน้อย 1 วัน ตัว console เสนอ 7 และ API ใช้ default 1 ส่วน RDS จะถ่าย storage snapshot ทุกวันใน backup window (ครั้งแรกเป็น full ครั้งต่อ ๆ ไปเป็น incremental) และ copy transaction log ไป S3 ทุกห้านาที บน Multi-AZ instance นั้น snapshot จะถ่ายจาก standby ทำให้ I/O ของ primary ไม่ต้องหยุด ทั้งสองอย่างรวมกันทำให้เรา restore ไปที่ **วินาทีไหนก็ได้** ใน retention period จนถึง `LatestRestorableTime` ที่ปกติอยู่ภายในห้านาทีล่าสุด การ restore สร้าง DB instance ใหม่ที่มี endpoint ใหม่เสมอ ส่วนตัวต้นทางก็รันต่อไป

```sh
# Bring back the orders database as it was at 09:41 UTC, next to the original
aws rds restore-db-instance-to-point-in-time \
  --source-db-instance-identifier orders-db \
  --target-db-instance-identifier orders-db-0941 \
  --restore-time 2026-10-07T09:41:00Z
```

**Manual snapshot** อยู่จนกว่าเราจะลบ และเรา copy ไปอีก Region หรือ share ให้ account อื่นได้ ทำให้มันเป็น copy สำหรับ disaster recovery ที่ง่ายที่สุด ส่วน Aurora จะทำ backup แบบต่อเนื่องและ incremental แทน โดยมี retention period 1 ถึง 35 วัน และใช้โมเดล restore ไปเป็น cluster ใหม่แบบเดียวกัน

backup storage ฟรีถึงระดับหนึ่ง: บน RDS ฟรีเท่ากับ storage ทั้งหมดที่ provision ไว้ใน Region ส่วนบน Aurora ฟรีเท่ากับขนาดของ cluster volume และ snapshot ที่ถ่ายภายใน retention period ไม่มีค่าใช้จ่ายเพิ่ม ถ้า retention นานกว่านั้น หรือมี manual snapshot เก่า ๆ ก็จะคิดเงินต่อ GB-month

### Read replica

**RDS read replica** รับการเปลี่ยนแปลงผ่าน asynchronous replication ของ engine เอง (สำหรับ PostgreSQL คือ streaming replication) ตัว RDS for PostgreSQL มี replica ได้ถึง 15 ตัวต่อ source จะอยู่ใน Region เดียวกันหรือ Region อื่นก็ได้ replica แต่ละตัวเป็น DB instance เต็มตัวที่มี storage และ endpoint ของตัวเอง และมันมี lag: `ReplicaLag` ใน [CloudWatch](../amazon-cloudwatch/) บอกว่าตามหลังแค่ไหน และ report ใน step 2 อ่านได้ `o-980` เพราะการเปลี่ยนแปลงยังมาไม่ถึง ส่วน replica ไม่ได้เป็นเป้า failover ของ primary (นั่นเป็นงานของ standby) เรา promote replica ให้เป็น instance เดี่ยวได้ แต่ replication ของมันก็จะจบไปตลอด และ RDS for PostgreSQL 14.1 ขึ้นไปรองรับ cascading replica ด้วย เรื่อง lag และ stale read มีอธิบายละเอียดในหน้า [Read Replicas](../read-replicas/)

**Aurora reader** attach เข้ากับ cluster volume แทนที่จะเก็บ copy ไว้เอง โดย reader ได้ถึง 15 ตัวต่อ cluster รับ read ผ่าน **reader endpoint** ที่กระจาย connection ไปให้พวกมัน หรือผ่าน custom endpoint ที่ชี้ไปที่ subset ที่เลือกไว้ เช่น reader หนึ่งตัวที่กันไว้ให้ report ส่วน AWS ระบุว่า lag ของ Aurora reader ปกติต่ำกว่า 100 ms อยู่มาก และ reader ทุกตัวยังเป็นเป้า failover ได้ด้วย

### Failover และ endpoint

แอปควรต่อด้วยชื่อ endpoint ไม่ใช่ IP address

- **RDS Multi-AZ DB instance** เมื่อ host, storage, network หรือ Availability Zone ของ primary พัง RDS จะ promote standby และเปลี่ยน DNS record ของ instance ให้ชี้ไปที่มัน ปกติใช้เวลา 60–120 วินาที และนานกว่านั้นถ้าต้อง recover transaction ใหญ่ ส่วน connection ที่เปิดอยู่จะขาด ทำให้ client ต้อง reconnect ไปที่ชื่อเดิม และ AWS แนะนำว่า client ที่เป็น Java ควร cache คำตอบ DNS ไว้ไม่เกิน 60 วินาที
- **Aurora** ตัว **cluster endpoint** ชี้ไปที่ writer เสมอ เมื่อ writer ล่ม Aurora จะ promote reader ที่ priority สูงที่สุด (promotion tier 0 ก่อน แล้วตามด้วย instance ที่ใหญ่ที่สุด) และ service ส่วนใหญ่กลับมาภายใน 60 วินาที บ่อยครั้งภายใน 30 วินาที ส่วน cluster ที่ไม่มี reader ต้องสร้าง writer ใหม่ ปกติใช้เวลาไม่ถึง 10 นาที ทำให้ AWS แนะนำให้มี reader อย่างน้อยหนึ่งตัวในอีก AZ

ซ้อมไว้ก่อนจะต้องใช้จริง:

```sh
aws rds reboot-db-instance --db-instance-identifier orders-db --force-failover   # RDS Multi-AZ
aws rds failover-db-cluster --db-cluster-identifier orders \
  --target-db-instance-identifier orders-reader-1                               # Aurora
```

การ promote แบบเดียวกันในระดับ Region ก็คือ [Active-Passive Failover](../active-passive-failover/): ใช้ read replica ข้าม Region หรือ Aurora global database

### RDS Proxy

connection ของ PostgreSQL แต่ละตัวคือ server process หนึ่งตัว และ Lambda function ที่ scale ไปถึงหลายร้อย invocation พร้อมกันก็เปิด connection ได้เป็นร้อย ๆ ตัว ส่วน **RDS Proxy** อยู่ตรงกลาง: มันเก็บ pool ของ database connection ไว้ และให้ client ยืมไปหนึ่งตัวตลอด transaction ทำให้ client connection จำนวนมากใช้ database connection ไม่กี่ตัวร่วมกัน เพดานของ pool คือ `MaxConnectionsPercent` ของ `max_connections` ของ database ส่วน connection ที่เกินกว่าที่ pool รับได้จะเข้าคิว และถูกปฏิเสธเมื่อถึงขีดจำกัด

- มันรันใน VPC เดียวกับ database และไม่เคยเปิดให้เข้าจาก public ตัว client ยืนยันตัวตนกับมันด้วย IAM ได้ และมันต่อเข้า database ด้วย credential จาก Secrets Manager หรือด้วย IAM database authentication
- ระหว่าง failover มันเปิด client connection ค้างไว้ และส่ง traffic ไปที่ primary ตัวใหม่โดยไม่ต้องรอ DNS ส่วน AWS บอกว่าวิธีนี้ลดเวลา failover ได้ถึง 66% สำหรับ Aurora Multi-AZ database
- ใช้ได้กับ RDS for MariaDB, MySQL, PostgreSQL และ SQL Server และกับ Aurora MySQL และ PostgreSQL แต่ใช้กับ Db2 หรือ Oracle ไม่ได้
- **Pinning** ทำให้การแชร์หายไป: session state ที่ client อื่นไม่ควรได้รับต่อ จะผูก client ไว้กับ database connection ตัวเดียวจนกว่าจะ disconnect สำหรับ PostgreSQL ได้แก่ `SET`, prepared statement, temporary table, cursor, `LISTEN`, advisory lock ระดับ session และ sequence function อย่าง `nextval`

สำหรับ Aurora ยังมี **RDS Data API** ด้วย: HTTPS endpoint ที่รัน SQL ด้วย credential จาก Secrets Manager โดยที่ฝั่งที่เรียกไม่ต้องถือ connection เลย

### Parameter group

setting ของ engine อยู่ใน **parameter group**: DB parameter group สำหรับ instance และ DB cluster parameter group สำหรับ Aurora cluster หรือ Multi-AZ DB cluster ตัว default group แก้ไม่ได้ เลยต้องสร้างของตัวเองก่อนจะต้องเปลี่ยนอะไร ตัว parameter แบบ dynamic มีผลทันที ส่วนแบบ static ต้องรอ reboot และ instance จะแสดง `pending-reboot` จนกว่าจะถึงตอนนั้น การเปิด logical decoding สำหรับ [Change Data Capture](../change-data-capture/) เป็นตัวอย่าง: ตั้ง static parameter `rds.logical_replication` เป็น `1` แล้ว reboot

### Security

- **Network:** เก็บ instance ไว้ใน private subnet และให้ security group รับ port 5432 จาก application tier เท่านั้น แบบในหน้า [Amazon VPC](../amazon-vpc/)
- **Credential:** ถ้าใช้ `--manage-master-user-password` ตัว RDS จะเก็บ master password ไว้ใน Secrets Manager และ rotate ให้ได้ ส่วน **IAM database authentication** (MariaDB, MySQL และ PostgreSQL ทั้งบน RDS และ Aurora) ใช้ token จาก `aws rds generate-db-auth-token` แทน password โดย token นี้ sign ด้วย Signature Version 4 และใช้ได้ 15 นาที ส่วนบน PostgreSQL ตัว database user ต้องมี role `rds_iam`
- **Encryption at rest** ใช้ AWS KMS key และครอบคลุม storage, log, automated backup, read replica และ snapshot โดยต้องเลือกตั้งแต่ตอนสร้าง instance และปิดทีหลังไม่ได้ ถ้าจะ encrypt instance ที่มีอยู่แล้ว ให้ restore จาก copy ของ snapshot ที่ encrypt แล้ว หรือใช้ blue/green deployment ส่วน snapshot ที่ copy ไป Region อื่นต้องใช้ KMS key ใน Region นั้น

### Monitoring

CloudWatch ได้รับ metric ของ instance (`CPUUtilization`, `FreeStorageSpace`, `DatabaseConnections`, `ReplicaLag`, `AuroraReplicaLag`) และ Enhanced Monitoring เพิ่ม metric ระดับ operating system ที่ละเอียดได้ถึงหนึ่งวินาที ตอนนี้การวิเคราะห์ระดับ query อยู่ที่ **CloudWatch Database Insights** ส่วน Performance Insights นั้น AWS กำหนด end of life ไว้ที่ 31 กรกฎาคม 2026 และย้าย user ของมันมาแล้ว โหมด Standard ของ Database Insights เก็บ metric ละเอียดราย query ไว้ 7 วันโดยไม่คิดเงิน ส่วนโหมด Advanced เพิ่มการวิเคราะห์ lock และ execution plan พร้อม retention ที่นานกว่า ส่วน RDS event อย่างเช่น failover ก็ใช้ขับ notification ของ [SNS](../amazon-sns/) หรือ rule ของ [EventBridge](../amazon-eventbridge/) ได้

### Upgrade: blue/green deployment และ Extended Support

minor version มาใน maintenance window ส่วนสำหรับ major version, การเปลี่ยน parameter หรือการเปลี่ยน schema ตัว **blue/green deployment** จะ copy production environment ไปเป็น staging environment (green) และคอย sync ไว้ด้วย replication โดยสำหรับ RDS for PostgreSQL จะเป็น physical replication หรือเป็น logical replication สำหรับการ upgrade major version จากนั้นเราทดสอบ green แล้วค่อย switch over ขั้นนี้ปกติใช้เวลาไม่ถึงหนึ่งนาที ไม่เสียข้อมูล และมี guardrail คอยป้องกัน วิธีนี้ใช้ได้กับ RDS for MariaDB, MySQL และ PostgreSQL (11.1 ขึ้นไป) และกับ Aurora MySQL และ PostgreSQL แต่ใช้กับ Db2, Oracle หรือ SQL Server ไม่ได้

เมื่อ major version ไปถึงจุดสิ้นสุดของ RDS standard support ตัว instance ที่ยังอยู่บน version นั้นจะถูกพาเข้า **RDS Extended Support** ที่เป็นบริการแบบเสียเงินที่ให้ security fix และ critical fix ต่อได้อีกถึงสามปีสำหรับ PostgreSQL ถ้าไม่อยากเสียค่านี้ ให้ตั้ง `--engine-lifecycle-support open-source-rds-extended-support-disabled` ตอนสร้างหรือแก้ instance แล้ว RDS จะ upgrade มันไปเป็น major version ถัดไปที่ยัง support อยู่เมื่อ standard support หมด

### Aurora: storage ที่สร้างจาก log

paper ของ SIGMOD ปี 2017 โดย Verbitski et al. อธิบาย design ที่อยู่เบื้องหลัง step 3

- **สิ่งที่วิ่งข้าม network คือ log** ตัว database instance ส่งแค่ redo log record ไปที่ storage และไม่เคยเขียน data page กลับ ไม่ว่าจะเพื่อ checkpoint หรือเพื่อเคลียร์ที่ใน cache ของมัน ส่วน storage node เอา record ไป apply และสร้าง page ขึ้นมาเองเบื้องหลัง
- **หก copy, quorum สี่** volume ถูกแบ่งเป็น segment (ตาม paper คือ segment ละ 10 GB) และแต่ละ segment ถูกเก็บไว้หกชุด AZ ละสอง copy ในสาม AZ การเขียนจะ durable เมื่อสี่ copy ตอบรับ ตัว volume เสีย AZ ทั้ง AZ บวกอีกหนึ่ง copy ได้โดยไม่เสียข้อมูล และเสีย copy ไหนก็ได้สองชุด รวมถึง AZ ทั้ง AZ โดยยังเขียนได้อยู่ การอ่านปกติไม่ต้องใช้ quorum เพราะ instance รู้ว่า copy ไหนเป็นตัวล่าสุด ส่วน read quorum สามใช้สร้าง state ขึ้นใหม่หลัง crash ตัว segment ที่พังจะถูก copy กลับมาอย่างเร็ว (paper ระบุ 10 วินาทีสำหรับ 10 GB บน link 10 Gbps) ทำให้ช่วงที่อาจเกิด failure ครั้งที่สองสั้น
- **Reader ใช้ volume ร่วมกัน** ตัว writer ยัง stream log record ไปให้ reader ด้วย แล้ว reader ก็ update page ที่ถืออยู่ใน memory ทำให้ lag สั้น และการเพิ่ม reader หนึ่งตัวก็ไม่ต้อง copy ข้อมูล
- **Fast clone** ใช้ page ร่วมกับ source จนกว่าฝั่งใดฝั่งหนึ่งจะเปลี่ยนมัน (copy-on-write) โดย clone 15 ตัวแรกของ source หนึ่งทำงานแบบนั้น ส่วนตัวหลังจากนั้นเป็น full copy
- **Global database** เพิ่ม secondary Region แบบ read-only ได้ถึง 10 Region โดย replicate บน infrastructure เฉพาะ ด้วย lag ที่ปกติต่ำกว่าหนึ่งวินาที การ switchover ย้าย writer ไปที่ secondary Region โดยไม่เสียข้อมูล ส่วน failover ทำแบบเดียวกันเมื่อเสีย primary Region ไป
- **Aurora Serverless v2** (instance class `db.serverless` โดยเอกสารปัจจุบันเรียกมันสั้น ๆ ว่า Aurora serverless) ปรับขนาดแต่ละ instance เป็นหน่วย Aurora capacity unit (ACU) หน่วยละประมาณ 2 GiB ของ memory พร้อม CPU และ networking ที่ได้สัดส่วนกัน ส่วน engine และ platform version ใหม่ ๆ scale ได้ตั้งแต่ 0 ถึง 256 ACU (Aurora PostgreSQL 13.15, 14.12, 15.7, 16.3 ขึ้นไป และ Aurora MySQL 3.08 ขึ้นไป) และ instance ที่ตั้งค่าต่ำสุดเป็น 0 จะ pause หลังไม่มี connection เป็นเวลา 300 วินาทีถึงหนึ่งวัน (`SecondsUntilAutoPause`) มันกลับมาทำงานได้ในประมาณ 15 วินาที หรือ 30 วินาทีขึ้นไปถ้า pause นานเกินหนึ่งวัน ส่วน instance แบบ serverless และแบบ provisioned อยู่ใน cluster เดียวกันได้
- **Aurora Standard หรือ I/O-Optimized** แบบ Standard คิดค่า storage บวกทุกล้าน I/O request ส่วน I/O-Optimized ไม่คิดค่า I/O แต่แพงกว่าต่อ instance-hour และต่อ GB โดย AWS แนะนำให้ใช้ I/O-Optimized เมื่อ I/O คิดเป็น 25% ขึ้นไปของบิล Aurora การเปลี่ยนไปเป็น I/O-Optimized ทำได้ทุก ๆ 30 วัน ส่วนการเปลี่ยนกลับทำได้ทุกเมื่อ
- **Aurora PostgreSQL Limitless Database** กระจาย write ไปบน writer instance หลายตัว สำหรับ workload ที่โตเกิน writer ตัวเดียว

### Aurora DSQL แบบสั้น ๆ

Aurora DSQL ใช้ชื่อ Aurora เหมือนกัน แต่เป็น service แบบ serverless อีกตัวหนึ่ง: SQL database แบบ distributed ที่ compatible กับ PostgreSQL โดยไม่มี instance ให้เลือก มันรับ write ได้ในทุก Region ของ multi-Region cluster และ replicate แบบ synchronous ด้วย strong consistency และ AWS ออกแบบมันให้มี availability 99.99% ใน Region เดียว และ 99.999% ข้าม Region มันใช้ optimistic concurrency control: transaction ที่ชนกันจะ fail ตอน commit ด้วย SQLSTATE `40001` และต้อง retry ส่วนระดับ isolation ถูกตั้งตายตัวไว้ที่ repeatable read และ feature บางอย่างของ PostgreSQL อย่าง temporary table และ trigger ก็ไม่มี ให้มองมันเป็น design ใหม่สำหรับ workload แบบ active-active ไม่ใช่ที่สำหรับย้าย PostgreSQL application ที่มีอยู่ไปโดยไม่แก้อะไร

### ค่าใช้จ่าย

ทั้งสองตัวคิดค่า instance-hour รายวินาที ขั้นต่ำ 10 นาที ค่า storage ต่อ GB-month และค่า backup storage ส่วนที่เกินโควตาฟรี ส่วน Aurora Standard คิดค่า I/O request เพิ่ม ราคา on-demand ใน us-east-1 จาก price list ของ AWS วันที่ 1 ตุลาคม 2026:

| | RDS for PostgreSQL, Single-AZ | RDS for PostgreSQL, Multi-AZ (standby หนึ่งตัว) | Aurora PostgreSQL, Standard | Aurora PostgreSQL, I/O-Optimized |
|---|---|---|---|---|
| `db.r7g.large` ต่อชั่วโมง | $0.239 | $0.478 | $0.276 ต่อ instance | $0.359 ต่อ instance |
| Storage ต่อ GB-month | $0.115 (`gp3`) | $0.23 (`gp3`) | $0.10 | $0.225 |
| I/O request | ไม่คิดราย request | ไม่คิดราย request | $0.20 ต่อล้าน | ไม่คิด |

สำหรับสองตัวเลือกใน diagram ค่า instance อย่างเดียวคือ $0.717 ต่อชั่วโมงสำหรับตัวเลือก A (Multi-AZ บวก replica หนึ่งตัว) และ $0.828 สำหรับตัวเลือก B (writer บวก reader สองตัว) บน Aurora Standard ยังไม่รวม storage และ I/O ส่วนราคาก็ต่างกันไปตาม Region และเปลี่ยนได้ ให้เช็กที่หน้า pricing

## อยู่ตรงไหนใน solution

- **Solution:** system of record ที่อยู่หลัง back end ของ web และ mobile, ผลิตภัณฑ์ SaaS, ร้านค้า และระบบงานภายในองค์กร ทุกที่ที่ข้อมูลเป็นแบบ relational และทีมไม่อยากรัน database server เอง และเป็นปลายทางเมื่อ database MySQL, PostgreSQL, Oracle หรือ SQL Server ที่ดูแลเองย้ายมาที่ AWS
- **Pattern ใน catalog นี้:** [Read Replicas](../read-replicas/) (RDS replica และ Aurora reader), [Active-Passive Failover](../active-passive-failover/) ในระดับ zone ด้วย Multi-AZ และในระดับ Region ด้วย replica ข้าม Region หรือ global database, [Disaster Recovery Strategies](../disaster-recovery-strategies/) ตั้งแต่ copy snapshot ไปอีก Region (backup and restore) ไปจนถึง secondary ที่รันอยู่ (pilot light, warm standby), [Database per Service](../database-per-service/) โดยมี instance, cluster หรืออย่างน้อยก็ database และ credential แยกต่อ service, [Change Data Capture](../change-data-capture/) ผ่าน logical replication เข้า AWS DMS หรือ Debezium แล้วต่อไปที่ [Kafka](../kafka/) คู่กับ [Transactional Outbox](../transactional-outbox/), [Blue-Green Deployment](../blue-green-deployment/) สำหรับ upgrade engine และ back end แบบ [Serverless](../serverless/) บน [AWS Lambda](../aws-lambda/) ผ่าน RDS Proxy หรือ Data API
- **ของที่อยู่ข้าง ๆ บ่อย ๆ:** [Amazon VPC](../amazon-vpc/) ที่มี private subnet และ security group, RDS Proxy, Secrets Manager, AWS KMS, [AWS IAM](../aws-iam/), CloudWatch, [Amazon S3](../amazon-s3/) สำหรับ export snapshot, cache อย่าง [Redis](../redis/) บน ElastiCache และ AWS DMS สำหรับการ migrate
- **Managed offering:** RDS และ Aurora คือ managed service ของ AWS สำหรับ engine ในหน้า [PostgreSQL](../postgresql/) และ engine อื่นที่ list ไว้ข้างบน ถ้าอยู่บน AWS ทางเลือกอื่นคือรัน PostgreSQL เองบน EC2 ส่วน Google Cloud (Cloud SQL, AlloyDB) และ Azure (Azure Database for PostgreSQL) ก็มี service ที่เทียบกันได้

## ใช้ตอนไหนดี

เลือก **RDS** เมื่ออยากได้ engine มาตรฐานที่มีคนจัดการ backup, patch และ failover ให้ ในราคาต่อชั่วโมงที่ต่ำที่สุด ใช้ Multi-AZ สำหรับ production และ Single-AZ สำหรับ development และข้อมูลที่ restore ได้ เลือก **Aurora** เมื่อเวลา failover สำคัญ เมื่องาน read ต้องการ replica หลายตัวที่ lag ต่ำและเป็นเป้า failover ได้ด้วย เมื่อข้อมูลอาจโตเกิน 64 TiB หรือเมื่ออยากได้ global database, fast clone หรือ Serverless v2 ส่วนการรัน PostgreSQL เองบน EC2 ให้ทำก็ต่อเมื่อต้องการสิ่งที่ managed service ไม่ให้ และเลือก [Amazon DynamoDB](../amazon-dynamodb/) เมื่อ access pattern เป็นแบบใช้ key และปริมาณ write ต้อง scale เกิน primary ตัวเดียว

| | RDS Single-AZ | RDS Multi-AZ | Aurora | PostgreSQL บน EC2 | [DynamoDB](../amazon-dynamodb/) |
|---|---|---|---|---|---|
| instance หรือ AZ พัง | ไม่มี standby: volume หายก็ต้อง restore และเสียข้อมูลได้ถึงช่วง ~5 นาทีล่าสุด | standby รับช่วงต่อ ปกติภายใน 60–120 s ไม่เสียข้อมูลที่ commit แล้ว | reader รับช่วงต่อ ส่วนใหญ่ภายใน 60 s | แล้วแต่ที่เราสร้างเอง (streaming replication, Patroni) | service จัดการเองข้างใน ข้อมูลเก็บไว้ในสาม AZ |
| Scale การอ่าน | async read replica ได้ถึง 15 ตัว | เหมือนกัน แต่ standby ไม่รับ read | reader ได้ถึง 15 ตัวบน volume ที่ใช้ร่วมกัน | standby ที่เรารันเอง | partition, read แบบ eventually consistent เป็นค่า default |
| Storage | EBS ได้ถึง 64 TiB, กำหนดขนาดเองหรือใช้ autoscale | เหมือนกัน แต่เขียนสองครั้ง | โตเองได้ถึง 128 หรือ 256 TiB | EBS volume ที่เราดูแลเอง | โตเอง |
| ใครรัน | AWS: เข้า OS ไม่ได้ | AWS: เข้า OS ไม่ได้ | AWS: เข้า OS ไม่ได้ | เรา | AWS แบบ serverless |
| โครงสร้างค่าใช้จ่าย | instance-hour, storage | ประมาณสองเท่าของ Single-AZ | แพงกว่าต่อ instance บวกค่า I/O บน Standard | instance, volume และเวลาของเรา | request หรือ capacity และ storage |
| เลือกเมื่อต้องการ | development, ข้อมูลที่ restore ได้ | production บน engine มาตรฐาน | failover เร็ว, reader หลายตัว, volume ใหญ่ | เข้าถึง OS, extension หรือ version ที่ไม่ support | การเข้าถึงแบบ key-value ที่ scale ไหนก็ได้ |

## ได้อะไร เสียอะไร

- **Managed แปลว่ามีข้อจำกัด** ไม่มีการเข้าถึง operating system และไม่มี superuser เต็มรูปแบบ (procedure และ system table แบบ privileged บางตัวห้ามใช้) ได้แค่ engine version และ extension ที่ AWS support และตั้งค่าผ่าน parameter group
- **Failover ก็ยังทำให้ connection หลุด** แม้ failover แค่ 30 วินาทีก็ทำให้ connection ที่เปิดอยู่ขาด และทำให้ transaction ที่ in flight อยู่ fail ทำให้ client ต้องมี retry, cache DNS ไว้สั้น ๆ และ write แบบ idempotent
- **Replica มี lag** ตัว RDS read replica เป็น asynchronous และ Aurora reader ตามหลังเป็น millisecond ทางที่ต้อง read-your-writes ควรไปที่ writer
- **มี writer ตัวเดียว** ทั้งสองตัว scale write ได้แค่ด้วยการย้ายไป instance ที่ใหญ่ขึ้น ถ้าเกินกว่านั้นก็ต้องไปที่ sharding, Aurora PostgreSQL Limitless Database หรือ Aurora DSQL แต่ละทางก็มี trade-off ของตัวเอง
- **ค่าใช้จ่ายที่ไม่คาดคิด** Multi-AZ ทำให้ราคา instance และ storage เป็นสองเท่า ส่วน Aurora Standard คิดเงินทุก I/O, backup retention ที่นานและ snapshot เก่า ๆ ก็สะสมเป็นเงิน และ major version ที่ปล่อยไว้เลยวันหมด standard support จะเริ่มเสียค่า Extended Support
- **Lock-in ไม่เท่ากัน** RDS for PostgreSQL คือ community PostgreSQL และย้ายออกได้ด้วย `pg_dump` หรือ logical replication ส่วน storage, global database และ Serverless v2 ของ Aurora มีแค่บน AWS ถึงแม้ SQL และ driver จะยังเป็นมาตรฐานก็ตาม

## ข้อควรรู้ตอนลงมือทำ

- **Setup สำหรับ production:** Multi-AZ บน RDS หรือ Aurora cluster ที่มี reader อย่างน้อยหนึ่งตัวในอีก AZ, เปิด deletion protection, ถ่าย final snapshot ตอนลบ และใช้ custom parameter group ตั้งแต่วันแรก
- **Connection:** ต่อด้วยชื่อ endpoint, cache DNS ไว้ไม่เกิน 60 วินาที และ retry แบบมี backoff หลัง failover และให้วาง RDS Proxy ไว้หน้า Lambda และ client อื่นที่ traffic มาเป็นระลอก และคอยดู pinned connection
- **Backup:** เก็บ automated backup อย่างน้อย 7 วัน, copy snapshot ไป Region ที่สอง (พร้อม KMS key ที่นั่น) ถ้าธุรกิจต้องการ และซ้อม point-in-time restore กับ failover ทุกไตรมาส
- **Security:** private subnet, security group ที่รับแค่ application tier, TLS บนทุก connection, encryption ที่เลือกตั้งแต่ตอนสร้าง และ password ใน Secrets Manager หรือใช้ IAM database authentication
- **Monitoring:** ตั้ง alarm ที่ `ReplicaLag` หรือ `AuroraReplicaLag`, `FreeStorageSpace` (RDS), CPU และจำนวน connection, ใช้ Database Insights หา slow query และ subscribe failover event
- **Upgrade:** ทำตามปฏิทิน support ของ engine, ทดสอบ major upgrade ด้วย blue/green deployment และตัดสินใจให้ชัดว่าจะจ่ายค่า Extended Support หรือไม่
- **Change data capture:** หลังตั้ง `rds.logical_replication = 1` ให้คอยดู replication slot เพราะ consumer ที่ค้างจะทำให้ database เก็บ WAL ไว้จน disk เต็ม
