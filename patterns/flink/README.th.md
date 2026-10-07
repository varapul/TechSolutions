## ปัญหา

Acme Shop อยากจับ fraud บัตรให้ได้ตอนที่มันกำลังเกิด เมื่อบัตรใบหนึ่งสั่งเกิน 5 order ภายใน 10 นาที ทีม fraud อยากได้ alert ภายในไม่กี่วินาที ส่วนทีม operations อยากเห็นจำนวน order ต่อนาทีต่อประเทศแบบ live ตัว order ไหลผ่าน Kafka topic `orders` อยู่แล้ว topic นี้มี 3 partition (ดู [Apache Kafka](../kafka/))

consumer service ที่นับใน memory จะเจอปัญหาสี่ข้อ:

- **จำนวนที่นับได้คือ state** มันต้องรอดผ่านการ restart และการ deploy และพอเครื่องเดียวไม่พอแล้ว ทุก order ของบัตรใบหนึ่งต้องไปถึง instance ที่ถือจำนวนของบัตรใบนั้น
- **order มาช้าและไม่เรียงลำดับ** มือถือสัญญาณหลุด client retry และ partition สามตัวถูกอ่านขนานกัน ทำให้ "10 นาทีล่าสุด" ที่วัดด้วยนาฬิกาตอนที่ order มาถึงนับ order ผิดตัว
- **การ crash ต้องไม่เปลี่ยนผลลัพธ์** หลัง restart ตัว service ต้องไม่ข้าม order และไม่นับซ้ำ
- **database ต่อหนึ่ง event ช้าและก็ยังไม่แม่น** การเขียนทุกจำนวนลง store ข้างนอกเพิ่ม network round trip ทุก order และตอน crash ตัว write กับตำแหน่งของ input ก็ยังเหลื่อมกันได้

Apache Flink รันการคำนวณแบบมี state บน stream ที่ไม่มีวันจบ (และบน stream ที่มีขอบเขตด้วย) บน cluster ของหลายเครื่อง มันเก็บ state ไว้ข้าง ๆ การคำนวณ แบ่งตาม key วัดเวลาด้วย timestamp ที่ event พกมา และ snapshot state ทั้งหมดพร้อมกับตำแหน่งใน input แบบ consistent ทำให้ failure หนึ่งครั้งเสียแค่การ replay จาก snapshot ล่าสุด แทนที่จะได้จำนวนที่ผิด

## ทำงานยังไง

### Dataflow: source, operator, sink และ parallelism

โปรแกรม Flink อธิบาย **dataflow graph**: source อ่าน record, operator แปลงมัน (map, filter, `keyBy`, window, process function, join) และ sink เขียนผลลัพธ์ออกไป ตัว Flink รัน operator แต่ละตัวเป็น **subtask** ที่ขนานกันหลายตัว ระบบตรวจ fraud รันด้วย parallelism 3 เลยมี source subtask สามตัว count subtask สามตัว และ sink subtask สามตัว ส่วนระหว่าง operator สองตัว record จะอยู่ใน subtask เดิม (การเชื่อมแบบ *forward* ที่ Flink chain รวมเป็น task เดียวบน thread เดียวได้) หรือไม่ก็ถูกกระจายใหม่: `keyBy` ส่งแต่ละ record ไปที่ subtask ที่เป็นเจ้าของ key ของมัน ส่วน `rebalance` กระจาย record แบบ round-robin

Kafka source กระจาย partition ไปให้ subtask ของมัน ทำให้ถ้ามี 3 partition กับ parallelism 3 แต่ละ source subtask จะอ่าน partition เดียวพอดี Kafka แบ่ง partition ของ order ตามลูกค้า แต่ระบบตรวจ fraud ต้องการให้จัดกลุ่มตามบัตร ตัว job เลยเรียก `keyBy(card)`: source subtask ทุกตัวส่งไปหา count subtask ได้ทุกตัว และ order ทั้งหมดของบัตรใบหนึ่งก็ไปจบที่ตัวเดียวกัน ไม่ว่าจะมาจาก partition ไหน

### Keyed state และ key group

`keyBy` ไม่ได้ map key ไปที่ subtask ตรง ๆ Flink จะ hash แต่ละ key ไปลงหนึ่งใน **key group** ที่มีจำนวนตายตัว เท่ากับ **maximum parallelism** ของ job (default ประมาณ 1.5 เท่าของ parallelism แต่อย่างน้อย 128 ทำให้ job นี้ได้ 128) แล้วให้แต่ละ subtask ถือช่วงของ key group ที่ต่อเนื่องกัน: ที่นี่คือ 0–42, 43–85 และ 86–127 ส่วนตัวเลขใน animation เป็นของจริง: ถ้าเอา string key `C-9` ไปผ่านการจัด key group ของ Flink มันจะลงที่ key group 126 ทำให้ count subtask 3/3 ถือจำนวนของ C-9

key group คือหน่วยที่ keyed state ย้ายไปมาเมื่อ job ถูก rescale ถ้าเปลี่ยนเป็น parallelism 4 แล้ว key group ชุดเดิม 128 ตัวจะถูกแบ่งเป็นสี่ส่วน แล้วแต่ละ subtask ก็โหลดช่วงใหม่ของตัวเองจาก snapshot ล่าสุด นี่ก็เป็นเหตุผลที่ maximum parallelism เปลี่ยนทีหลังไม่ได้ถ้าไม่ทิ้ง keyed state และเป็นเหตุผลที่ production readiness checklist บอกให้ตั้งค่ามันให้ชัด

**Keyed state** ผูกอยู่กับ key ปัจจุบัน: ใน count operator ตัว `ValueState`, `ListState`, `MapState`, `ReducingState` หรือ `AggregatingState` จะหมายถึงบัตรที่กำลังประมวลผลอยู่เสมอ ส่วน **operator state** เป็นของ subtask แทน (Kafka source เก็บ offset ของ partition ตัวเองแบบนี้) และ **broadcast state** เหมือนกันทุก subtask เช่นชุด rule ที่ส่งไปให้ทุกตัว ส่วน state ที่ไม่อย่างนั้นจะโตไปเรื่อย ๆ อย่างจำนวนของบัตรที่เงียบไปแล้ว ให้หมดอายุได้ด้วย time-to-live (`StateTtlConfig`)

### State backend

**state backend** กำหนดว่า state ที่กำลังใช้งานอยู่ที่ไหน (`state.backend.type`):

- **`hashmap`** (`HashMapStateBackend` เป็น default) เก็บ state เป็น Java object บน heap ของ TaskManager เข้าถึงได้เร็ว แต่ state ต้องใส่ใน memory ได้พอ
- **`rocksdb`** (`EmbeddedRocksDBStateBackend`) เก็บ state ที่ serialize แล้วใน RocksDB database แบบ embedded บน local disk ของ TaskManager ตัว state ใหญ่กว่า memory ได้มาก แลกกับการ serialize ทุกครั้งที่เข้าถึง และ checkpoint ทำแบบ incremental ได้: upload แค่ไฟล์ที่เปลี่ยนไปตั้งแต่ครั้งก่อน ระบบตรวจ fraud ใช้ตัวนี้
- **`forst`** (`ForStStateBackend` เป็นส่วนหนึ่งของ *disaggregated state management* ที่มากับ Flink 2.0) เก็บ state ใน remote storage อย่าง S3 แล้วใช้ local disk เป็น cache และอ่านเขียนแบบ asynchronous ผ่าน State V2 API ตัวใหม่ ทำให้การ recover และการ rescale ไม่ต้อง download state มาก่อน ณ Flink 2.3 เอกสารยังเรียกมันว่า experimental

กับสองตัวแรก การอ่านจำนวนหนึ่งครั้งคือการ lookup บน heap หรือ disk ในเครื่องเดียวกัน ไม่ใช่การเรียก database

### Event time, watermark และ window

Flink วัดเวลาได้สองแบบ **Processing time** คือนาฬิกาของเครื่องที่รัน operator: ง่าย แต่ผลลัพธ์ขึ้นกับว่า record บังเอิญมาถึงเมื่อไร ส่วน **event time** คือ timestamp ที่แต่ละ record พกมา ที่นี่คือเวลาที่สั่ง order ทำให้ผลลัพธ์ออกมาเหมือนกันไม่ว่า order จะมาแบบ live มาช้า หรือถูก replay จากสัปดาห์ที่แล้ว

ถ้าใช้ event time ตัว operator ต้องรู้ว่าเมื่อไรมันเห็นทุกอย่างจนถึงเวลาหนึ่งแล้ว สิ่งนั้นคือ **watermark** เป็น record พิเศษที่ไหลไปกับข้อมูล และประกาศว่าจะไม่มี event ที่เก่ากว่าเวลาที่กำหนดเข้ามาอีกแล้ว ตัว `WatermarkStrategy` บน source กำหนดว่ามันขยับยังไง ถ้าใช้ `forBoundedOutOfOrderness(Duration.ofSeconds(5))` ตัว watermark จะตามหลัง timestamp ที่มากที่สุดที่เห็นมาแล้วอยู่ 5 s (พูดให้เป๊ะคือ 5 s กับ 1 ms) และ Flink ส่งมันออกมาเป็นระยะ ทุก 200 ms เป็น default (`pipeline.auto-watermark-interval`) ตัว Kafka source ติดตาม watermark ต่อ partition แล้วรวมกัน ส่วน operator ที่มีหลาย input จะใช้ watermark ที่น้อยที่สุดของ input พวกนั้น ทำให้ partition ที่ช้าหรือ idle ตัวเดียวรั้งนาฬิกา event time ของทั้ง job ไว้ ตัว `withIdleness(...)` ทำให้ partition ที่เงียบไปเลิกรั้งมันไว้ และ watermark alignment ก็หยุด partition ที่วิ่งนำตัวอื่นไปไกลเกินไว้ก่อน

**window** รวบรวม record ของ key หนึ่งในช่วง event time ช่วงหนึ่ง และถูกประเมินเมื่อ watermark ผ่านจุดจบของมัน window assigner ที่มีมาในตัวครอบคลุม window แบบ **tumbling** (ขนาดคงที่ ไม่ซ้อนกัน อย่าง window 10 นาทีที่นี่) แบบ **sliding** (ขนาดคงที่ ซ้อนกัน เช่น 10 นาทีทุก ๆ นาที) แบบ **session** (ปิดเมื่อมีช่วงว่างที่ไม่มีความเคลื่อนไหว) และ global window ส่วน record ที่ window ของมันถูกประเมินไปแล้วถือว่า **late** ส่วน record ที่ late จะถูกทิ้งโดย default ตัว `allowedLateness(...)` เก็บ state ของ window ไว้นานขึ้นอีกหน่อย ให้ตัวที่ตามมาทีหลังยังอัปเดตมันได้ (เป็น 0 ถ้าไม่ได้ตั้ง) และ `sideOutputLateData(...)` ส่งอะไรก็ตามที่ช้ากว่านั้นไปที่ stream แยก คือ **side output** ที่เรานับหรือ reconcile ได้ แทนที่จะเสียมันไปเงียบ ๆ

ใน animation ตัว window `[10:00, 10:10)` ปิดเมื่อ order ที่ประทับเวลา 10:10:05 เข้ามาครบทั้งสาม partition ทำให้ watermark ขยับไปที่ 10:09:59.999 คือมิลลิวินาทีสุดท้ายของ window ส่วน order ที่ประทับเวลา 10:08:40 ที่มาถึงทีหลังจะไปที่ `late-orders`

### ระบบตรวจ fraud ในโค้ด

window operator รายงานผลเมื่อ window ของมันจบ ถ้าจะ alert ตอน order ที่หกแทนที่จะรอถึง 10:10 ตัวนับก็ต้องเขียนเป็น `KeyedProcessFunction` เป็น building block ระดับล่างที่รวม keyed state เข้ากับ timer (window ที่มี custom trigger ก็ใช้ได้เหมือนกัน) โค้ดนี้ compile และรันกับ Flink 2.3 ได้:

```java
class MoreThanFivePerTenMinutes extends KeyedProcessFunction<String, Order, Alert> {
    static final OutputTag<Order> LATE = new OutputTag<Order>("late-orders") {};
    static final long WINDOW = Duration.ofMinutes(10).toMillis();
    private transient MapState<Long, Integer> countPerWindow; // window end -> orders so far

    @Override
    public void open(OpenContext openContext) {
        countPerWindow = getRuntimeContext().getMapState(
                new MapStateDescriptor<>("count-per-window", Long.class, Integer.class));
    }

    @Override
    public void processElement(Order order, Context ctx, Collector<Alert> out) throws Exception {
        long end = order.placedAt() - order.placedAt() % WINDOW + WINDOW; // [10:00, 10:10) -> 10:10
        if (end - 1 <= ctx.timerService().currentWatermark()) { // its window has closed
            ctx.output(LATE, order);
            return;
        }
        Integer seen = countPerWindow.get(end);
        int count = (seen == null ? 0 : seen) + 1;
        countPerWindow.put(end, count);
        ctx.timerService().registerEventTimeTimer(end - 1); // fires once the watermark reaches the end
        if (count == 6) {
            out.collect(new Alert(ctx.getCurrentKey(), end, count));
        }
    }

    @Override
    public void onTimer(long timestamp, OnTimerContext ctx, Collector<Alert> out) throws Exception {
        countPerWindow.remove(timestamp + 1); // the window is over: free its state
    }
}
```

job ที่ครอบมันอ่าน `orders` ด้วย watermark 5 วินาที จัด key ตามบัตร และเขียน output สองทาง:

```java
WatermarkStrategy<Order> fiveSecondsLate = WatermarkStrategy
        .<Order>forBoundedOutOfOrderness(Duration.ofSeconds(5))
        .withTimestampAssigner((order, kafkaTimestamp) -> order.placedAt());

SingleOutputStreamOperator<Alert> alerts = env
        .fromSource(orders, fiveSecondsLate, "orders") // orders is a KafkaSource on topic orders
        .keyBy(Order::card)
        .process(new MoreThanFivePerTenMinutes())
        .uid("fraud-count"); // a stable ID that savepoints map the state to

alerts.sinkTo(fraudAlerts); // the KafkaSink below
alerts.getSideOutput(MoreThanFivePerTenMinutes.LATE).sinkTo(lateOrders);
```

ใน local test ที่ใช้ order ของ animation ป้อนตามลำดับที่มาถึง และมี watermark หลังทุก order เพื่อให้ผลลัพธ์ deterministic ตัว job ส่ง alert หนึ่งตัวสำหรับ C-9 (6 order ใน `[10:00, 10:10)`) และส่ง order ที่ประทับเวลา 10:08:40 ไปที่ side output

### Checkpoint: snapshot แบบ consistent โดยไม่ต้องหยุด

fault tolerance ของ Flink ตั้งอยู่บน **checkpoint**: snapshot แบบ consistent ของ state ทุก operator พร้อมตำแหน่ง input ที่เป็นของมัน Flink ทำมันด้วย **checkpoint barrier** เป็นรูปแบบหนึ่งของอัลกอริทึม distributed snapshot ของ Chandy–Lamport ที่ Carbone และคณะอธิบายไว้ในปี 2015:

1. checkpoint coordinator ใน JobManager บอก source ให้เริ่ม checkpoint *n* โดยที่นี่เริ่มทุก 30 s (`execution.checkpointing.interval`)
2. source แต่ละตัวบันทึกตำแหน่งของตัวเอง (สำหรับ Kafka คือ offset ในแต่ละ partition) แล้วปล่อย barrier *n* เข้าไปใน output stream ของมัน barrier เดินไปในแถวเดียวกับ record และไม่แซง record เลย มันเลยแบ่ง stream เป็นส่วนก่อน checkpoint *n* กับส่วนหลังจากนั้น
3. operator ที่มีหลาย input จะรอจน barrier *n* มาถึงครบทุก input (**alignment**) แล้วค่อย snapshot state ของตัวเองและส่ง barrier ต่อ ส่วนสำเนาจะถูกเขียนลง storage แบบ asynchronous ระหว่างที่ operator ประมวลผลต่อไป
4. เมื่อ sink ทุกตัว acknowledge barrier *n* แล้ว และ snapshot ทั้งหมดถูกเก็บเรียบร้อย (ใน `execution.checkpointing.dir` ที่นี่คือบน S3) checkpoint *n* ก็เสร็จสมบูรณ์

checkpoint จะปิดอยู่จนกว่าจะตั้ง interval และโหมด default ของมันคือ exactly-once (`execution.checkpointing.mode: EXACTLY_ONCE`) ตอนเจอ backpressure การ alignment อาจรั้ง checkpoint ไว้นาน ส่วน **unaligned checkpoint** (ตั้งแต่ Flink 1.11, `execution.checkpointing.unaligned.enabled`) ให้ barrier แซง record ที่รออยู่ใน buffer ได้ แล้วเก็บ record พวกนั้นเป็นส่วนหนึ่งของ snapshot แทน

state backend และ checkpoint ของระบบตรวจ fraud ใน `config.yaml`:

```yaml
# config.yaml (Flink 2.x)
parallelism.default: 3
state.backend.type: rocksdb
execution.checkpointing.incremental: true
execution.checkpointing.interval: 30 s
execution.checkpointing.dir: s3://acme-shop-flink/checkpoints/fraud-check
execution.checkpointing.savepoint-dir: s3://acme-shop-flink/savepoints/fraud-check
```

**การ recover** เมื่อ task fail หรือ TaskManager หายไป JobManager จะ restart task ที่โดนผลกระทบ พอเปิด checkpoint แล้ว restart strategy แบบ default คือ `exponential-delay` โดยรอเริ่มที่ 1 s และไม่เกิน 1 นาที ส่วน Flink จะ restart *pipelined region* ที่เล็กที่สุดที่มี failure อยู่ และเพราะ `keyBy` เชื่อม source subtask ทุกตัวเข้ากับ count subtask ทุกตัว region นั้นที่นี่ก็คือทั้ง job แล้ว operator ทุกตัวก็โหลด state ใหม่จาก checkpoint ล่าสุดที่เสร็จแล้ว และ source ก็ถอยกลับไปที่ offset ที่เก็บไว้ในนั้น ทำให้แต่ละ order เปลี่ยน state แค่ครั้งเดียวพอดี แม้ order บางตัวจะถูกอ่านสองครั้ง ตัว Kafka source ยัง commit offset ของมันกลับไปที่ Kafka เมื่อ checkpoint เสร็จด้วย แต่ทำแค่เพื่อให้ความคืบหน้าและ lag ไปโผล่ในเครื่องมือของ Kafka: Flink restore จาก checkpoint ของตัวเอง ไม่ใช่จาก commit พวกนั้น

### Savepoint

**savepoint** คือ snapshot ที่เราสั่งเองและเป็นเจ้าของเอง เราทำมันก่อน upgrade ก่อนเปลี่ยนเวอร์ชัน Flink ก่อน rescale หรือก่อนย้ายไปอีก cluster แล้วเริ่ม job ใหม่จากมัน Flink จัดการ checkpoint เอง และโดย default เก็บไว้แค่ตัวล่าสุดที่เสร็จแล้ว (`execution.checkpointing.num-retained: 1`) ส่วน savepoint จะอยู่ไปจนกว่าเราจะลบ และย้ายไปที่อื่นได้

```sh
bin/flink stop --savepointPath s3://acme-shop-flink/savepoints/fraud-check <jobId>  # take a savepoint, then stop
bin/flink run -s <savepointPath> fraud-check.jar                                     # start the new version from it
```

การ restore จะ map state ที่บันทึกไว้กลับไปที่ operator ตาม ID ของมัน เลยต้องให้ operator ที่มี state ทุกตัวมี `uid(...)` ที่คงที่ การเปลี่ยน ID ของ operator หรือเปลี่ยน type ของ state แบบไม่ compatible จะทำให้ restore พัง ส่วน savepoint ใช้ format แบบ *canonical* ที่ใช้ข้าม state backend ได้เป็น default หรือจะใช้ format แบบ *native* ของ backend ที่เร็วกว่าก็ได้ (`--type native`) ส่วน Flink 2.x ไม่รับประกันว่า state จะ compatible กับ 1.x ทำให้การย้ายจาก 1.20 ไป 2.x เป็นการ migrate ไม่ใช่แค่ restart จาก savepoint

### Exactly once แบบ end to end

checkpoint ทำให้ **state** เป็น exactly-once แต่ผลลัพธ์ที่เขียนออกไปข้างนอกแล้วเป็นอีกเรื่อง: หลัง restart Flink จะประมวลผล order ตั้งแต่ checkpoint ล่าสุดซ้ำอีกรอบ และ sink ธรรมดาก็จะเขียน alert พวกนั้นซ้ำสองครั้ง ส่วน exactly-once แบบ end-to-end ต้องมี source ที่ replay ได้ (Kafka, Kinesis, ไฟล์) และ sink ที่มีส่วนร่วมใน checkpoint:

- **transactional sink** ใช้ two-phase commit (ใน Flink 2.x คือ sink ที่ implement `SupportsCommitter`): ระหว่าง checkpoint มันเขียนลง transaction ที่เปิดอยู่ แล้ว pre-commit เมื่อ barrier ผ่าน และ commit หลัง checkpoint เสร็จแล้วเท่านั้น ตัว Kafka sink ทำแบบนี้ด้วย Kafka transaction ในโหมด `DeliveryGuarantee.EXACTLY_ONCE` คนอ่าน `fraud-alerts` ต้องตั้ง `isolation.level=read_committed` เพื่อข้าม record ที่ยังไม่ commit และ alert จะมองเห็นได้ก็ต่อเมื่อ checkpoint ถัดจากมันเสร็จ ที่นี่เลยช้าได้ถึงประมาณ 30 s
- **idempotent sink** ทำให้การ replay ไม่มีผลเสียแทน: การ upsert ตาม key ลง database หรือ search index เขียน row เดิมซ้ำแล้วได้ผลเหมือนเดิม

```java
KafkaSink<Alert> fraudAlerts = KafkaSink.<Alert>builder()
        .setBootstrapServers("kafka:9092")
        .setRecordSerializer(KafkaRecordSerializationSchema.builder()
                .setTopic("fraud-alerts")
                .setValueSerializationSchema(alertJson)
                .build())
        .setDeliveryGuarantee(DeliveryGuarantee.EXACTLY_ONCE) // the default is NONE
        .setTransactionalIdPrefix("fraud-check")             // unique per job on this Kafka cluster
        .build();
```

Kafka sink ของ DataStream มี default เป็น `DeliveryGuarantee.NONE` ส่วน Kafka connector ของ SQL มี default เป็น `'sink.delivery-guarantee' = 'at-least-once'` ถ้าใช้ exactly-once ให้ตั้ง `transaction.timeout.ms` ของ producer ให้สูงกว่า checkpoint ที่นานที่สุดบวกเวลา restart ไปเยอะ ๆ ไม่อย่างนั้น Kafka อาจ abort transaction ที่ Flink ยังตั้งใจจะ commit

### JobManager, TaskManager และ slot

Flink cluster รัน process สองแบบ:

- **JobManager** ทำหน้าที่ประสานงาน ตัว *Dispatcher* ของมันรับ job ผ่าน REST และให้บริการ web UI ส่วน *ResourceManager* แจก task slot และ *JobMaster* หนึ่งตัวต่อ job ก็ schedule task ประสานงาน checkpoint และรับมือกับ failure ถ้าต้องการ high availability ก็มี JobManager สำรองรอรับช่วงต่อจาก leader (ดู [Leader Election](../leader-election/))
- **TaskManager** คือ worker JVM ที่รัน subtask และแลกข้อมูลระหว่างกัน แต่ละตัวเปิด **task slot** ให้จำนวนหนึ่ง (`taskmanager.numberOfTaskSlots` default 1) ตัว slot จองส่วนแบ่งของ managed memory ของ TaskManager แต่ไม่ได้แยก CPU ส่วน subtask ของ operator ต่างตัวกันใน job เดียวกันใช้ slot ร่วมกันได้ ทำให้ slot เดียวถือ pipeline ทั้งเส้นได้ (source, count และ sink เหมือนแต่ละเลนใน animation) และ job หนึ่งต้องการ slot เท่ากับ parallelism ที่สูงที่สุดของมัน

job รันได้ใน **application mode** บน cluster ของตัวเองที่ `main()` ของโปรแกรมรันอยู่ หรือใน **session mode** บน cluster ที่รันยาว ๆ และแชร์กันหลาย job ส่วนโหมด per-job ไม่รองรับแล้วตั้งแต่ Flink 2.0 ถ้ารันบน Kubernetes การ integrate แบบ native ของ Flink จะเปิดและปิด TaskManager pod ของตัวเอง และ **Flink Kubernetes Operator** (1.16 กันยายน 2026) จัดการ job เป็น custom resource (`FlinkDeployment`, `FlinkSessionJob`): มัน upgrade job ด้วย `upgradeMode: savepoint`, `last-state` หรือ `stateless`, rollback upgrade ที่ fail, ทำ autoscale parallelism และรัน blue/green deployment ได้

### API, connector และ batch

- **DataStream API** (Java และ Python ผ่าน PyFlink) ให้ควบคุม keyed state, timer, side output และ custom window ได้เต็มที่ ส่วน process function คือระดับล่างสุดของมัน
- **Table API** และ **Flink SQL** อธิบายการคำนวณแบบเดียวกันในแบบ declarative แล้ว planner ก็แปลงเป็น dataflow ให้ จำนวนต่อนาทีของ dashboard ใช้ SQL แค่ไม่กี่บรรทัด โดยที่ clause `WATERMARK` ทำหน้าที่แทน `WatermarkStrategy`:

```sql
CREATE TABLE orders (
  order_id  STRING,
  card      STRING,
  country   STRING,
  placed_at TIMESTAMP_LTZ(3),
  WATERMARK FOR placed_at AS placed_at - INTERVAL '5' SECOND
) WITH (
  'connector' = 'kafka',
  'topic' = 'orders',
  'properties.bootstrap.servers' = 'kafka:9092',
  'properties.group.id' = 'order-stats',
  'scan.startup.mode' = 'earliest-offset',
  'format' = 'json'
);

SELECT window_start, country, COUNT(*) AS orders
FROM TUMBLE(TABLE orders, DESCRIPTOR(placed_at), INTERVAL '1' MINUTES)
GROUP BY window_start, window_end, country;
```

- **Connector** สำหรับไฟล์และ object storage มากับ Flink ส่วนตัวอื่นส่วนใหญ่ (Kafka, AWS connector สำหรับ Kinesis และ service อื่น, database ผ่าน JDBC, [Elasticsearch](../elasticsearch/) และอีกมาก) release แยก และมักตามหลัง release ของ Flink ส่วน ณ ตุลาคม 2026 ตัว Kafka connector ใหม่สุด (5.0.0) รองรับ Flink 2.1 และ 2.2 และเอกสาร Flink 2.3 ยังไม่มี Kafka connector release สำหรับ 2.3 ส่วน AWS connector ตัวใหม่สุด (6.0.1) รองรับ 2.0 และ connector ของ [MongoDB](../mongodb/) กับ Pulsar ยังรองรับ 1.x อยู่
- **Flink CDC** (3.6 ณ ตุลาคม 2026) สร้าง data integration pipeline ที่อธิบายด้วย YAML: มันอ่าน row ที่มีอยู่แล้วของ database แล้วตามด้วย change log ของมัน (เช่น binlog ของ MySQL) โดยไม่ lock table และ apply การเปลี่ยน schema ไปที่ปลายทาง แล้วยังคงการประมวลผลแบบ exactly-once ข้าม failure
- **Batch คือ stream ที่มีขอบเขต** โปรแกรม DataStream ตัวเดียวกันรันในโหมด batch บน input ที่มีขอบเขตได้ (`execution.runtime-mode: BATCH`) และ SQL ก็รันได้ทั้งสองแบบ ส่วน Flink 2.0 ถอด DataSet API ตัวเก่าออกไปแล้ว พร้อมกับ Scala API และ interface `SourceFunction` กับ `SinkFunction` แบบ legacy

### เวอร์ชัน

Flink 2.0 (มีนาคม 2025) เป็น major release แรกนับจาก 1.0 ในปี 2016 นอกจาก disaggregated state แล้ว มันยังถอด API ที่ deprecated ด้านบนออก ให้ Java 17 เป็น default (ขั้นต่ำคือ Java 11 และรองรับ Java 21) เปลี่ยน `flink-conf.yaml` เป็น `config.yaml` ที่เป็น YAML มาตรฐาน และเลิกให้ state compatible กับ 1.x จากนั้นก็มี Flink 2.1 (กรกฎาคม 2025), 2.2 (ธันวาคม 2025) และ 2.3 (มิถุนายน 2026) ตามมา โดย 2.3.0 เป็น stable release ล่าสุด ณ ตุลาคม 2026 ส่วนสาย 1.x จบที่ Flink 1.20 ที่โปรเจกต์ติดป้ายว่า long-term support และยังออก patch ให้อยู่ (1.20.5 มิถุนายน 2026)

## อยู่ตรงไหนใน solution

- **Solution** ตรวจจับ fraud และความผิดปกติใน payment, login หรือค่าจาก sensor, analytics แบบ real-time และ dashboard แบบ live, streaming ETL ที่ทำความสะอาด join และเติมข้อมูลให้ event ระหว่างทางเข้า data lake หรือ warehouse เช่นเป็น table ของ Apache Paimon หรือ Apache Iceberg, pipeline สำหรับ change data capture ด้วย Flink CDC และแอปแบบ event-driven ที่ตอบสนองต่อ pattern ตามเวลา (payment ที่ไม่ตามมาหลัง order ภายใน 15 นาที) ด้วย state และ timer
- **Pattern ที่มัน implement หรือช่วยรองรับ** consumer แบบมี state ใน [event-driven architecture](../event-driven-architecture/), [pipes and filters](../pipes-and-filters/) ในระดับ cluster โดยแต่ละ operator เป็น filter หนึ่งตัว, [change data capture](../change-data-capture/) ด้วย Flink CDC, [materialized view](../materialized-view/) และ read model ของ [CQRS](../cqrs/) ที่อัปเดตตาม stream อยู่ตลอด, ไอเดียเบื้องหลังเทคนิค [sliding window](../sliding-window/) (อัปเดตผลลัพธ์ที่สะสมอยู่ทุกครั้งที่ item เข้ามา แทนที่จะ scan ใหม่ทั้งหมด) ใน window aggregation แบบ incremental (`ReduceFunction`, `AggregateFunction`) และ [idempotent consumer](../idempotent-consumer/) ที่ปลายทางเมื่อ sink เข้าร่วม transaction ไม่ได้
- **เพื่อนบ้านที่มักเจอ** [Apache Kafka](../kafka/) หรือ [Amazon Kinesis Data Streams](../amazon-kinesis-data-streams/) ที่อยู่ข้างหน้า, Kafka topic, database, search index และ object storage ที่อยู่ข้างหลัง, [Amazon S3](../amazon-s3/) หรือ HDFS สำหรับ checkpoint และ savepoint, [Kubernetes](../kubernetes/) หรือ YARN สำหรับรันมัน, schema registry สำหรับ format ของ record และ metric ในระบบอย่าง [Prometheus](../prometheus/)
- **Managed offering** **Amazon Managed Service for Apache Flink** (ชื่อเดิมคือ Amazon Kinesis Data Analytics จนถึงสิงหาคม 2023) รันแอป Flink ที่เขียนด้วย Java, Scala หรือ Python และ Studio notebook ของมันก็รัน SQL, Python และ Scala แบบ interactive ได้ ณ ตุลาคม 2026 มันรองรับ Flink 2.3, 2.2, 1.20, 1.19, 1.18 และ 1.15 ส่วน capacity มาเป็น Kinesis Processing Unit (KPU) ตัวละ 1 vCPU และ memory 4 GB พร้อม running storage 50 GB บวก KPU เพิ่มอีกหนึ่งตัวต่อแอปสำหรับ orchestration คิดเงินรายวินาทีใน Region ส่วนใหญ่ (ตัวอย่างราคาใช้ $0.11 ต่อ KPU-hour ที่ US East (N. Virginia)) ตัว checkpoint เปิดเป็น default ทุก 60 s ส่วน *snapshot* ของมันก็คือ savepoint: เราสั่งทำเองได้ และถ้าตั้ง `SnapshotsEnabled` ตัว service จะทำให้ทุกครั้งที่แอปถูก update, scale หรือ stop ส่วน **Confluent Cloud for Apache Flink** เป็น service แบบ serverless บน AWS, Azure และ Google Cloud สำหรับ Flink SQL, Table API (Java generally available ส่วน Python อยู่ใน preview) และ user-defined function บน Kafka topic ของ Confluent มันคิดเงิน compute pool ตาม CFU ที่ใช้ต่อนาที และ statement ของมันเป็น exactly-once โดย default ถ้าจะรัน Flink เองบน Kubernetes ให้ใช้ Flink Kubernetes Operator
- **License** Apache Flink, Flink CDC และ Kubernetes Operator เป็นโปรเจกต์ของ Apache Software Foundation ภายใต้ Apache License 2.0

## ใช้ตอนไหนดี

เลือก Flink เมื่อ streaming job เก็บ state จริงจัง (จำนวน, session, join, pattern ตามเวลา) เมื่อผลลัพธ์ต้องถูกตาม event time แม้ข้อมูลจะมาช้าและไม่เรียงลำดับ เมื่อผลลัพธ์ต้องเป็น exactly-once หลัง failure และเมื่อ job อ่านจากหรือเขียนไปหาระบบหลายแบบ ในระดับที่ process เดียวไม่พอ ถ้าเป็น service ที่อ่าน Kafka topic แล้วเขียน Kafka topic และอยาก deploy เป็นส่วนหนึ่งของแอปตัวเอง Kafka Streams จะง่ายกว่า ถ้าทีมรัน Spark อยู่แล้ว และ latency ระดับวินาทีรับได้ Spark Structured Streaming ก็ทำให้ใช้ engine เดียวทั้ง batch และ streaming ส่วนงานที่ไม่มี state บนแต่ละ record (เติมข้อมูล, route, เรียก API) หรือ aggregate เล็ก ๆ ต่อ shard ตัว [Lambda function](../aws-lambda/) ที่อ่าน stream ก็ไม่ต้องมี cluster เลย

| | Apache Flink | Kafka Streams | Spark Structured Streaming | AWS Lambda บน stream |
|---|---|---|---|---|
| สิ่งที่ deploy | Flink cluster (JobManager และ TaskManager) ที่รัน job | Java library ใน service ของเราเอง แต่ละ instance ประมวลผล partition บางส่วน | Spark application (driver และ executor) | function ตัวหนึ่ง โดยมี event source mapping คอย poll stream แล้ว invoke มันเป็น batch |
| Input และ output | Kafka, Kinesis, ไฟล์, JDBC, Elasticsearch และอื่น ๆ ผ่าน connector ส่วน database ผ่าน Flink CDC | Kafka topic ทั้งขาเข้าและขาออก | Kafka และไฟล์มีในตัว ส่วน sink มีไฟล์, Kafka และ `foreachBatch` | ขาเข้าคือ Kinesis, [DynamoDB](../amazon-dynamodb/) Streams, Kafka (Amazon MSK หรือดูแลเอง), [SQS](../amazon-sqs/) และอื่น ๆ ส่วนขาออกคืออะไรก็ได้ที่โค้ดเรียก |
| การประมวลผล | ทีละ record ตาม event time พร้อม watermark | ทีละ record ตาม event time พร้อม grace period สำหรับ record ที่มาช้า | micro-batch โดย default และมีโหมด continuous ให้เลือกที่ latency ต่ำกว่าแต่ส่งแบบ at-least-once | record หนึ่ง batch ต่อการ invoke หนึ่งครั้ง |
| State | keyed state บน heap หรือใน RocksDB บนเครื่อง แล้ว snapshot ไป S3 หรือ HDFS | RocksDB store บนเครื่องที่มี changelog topic แบบ compacted หนุนหลัง | state store ใน memory ของ executor หรือ RocksDB ที่บันทึกไปที่ checkpoint location | ไม่มีระหว่างการ invoke ยกเว้น tumbling window (เฉพาะ Kinesis และ DynamoDB Streams ไม่เกิน 15 นาที และ state 1 MB ต่อ shard) |
| การรับประกัน | state แบบ exactly-once และ end to end ได้ถ้าใช้ sink แบบ transactional หรือ idempotent | at-least-once โดย default และ `exactly_once_v2` จาก Kafka ไป Kafka | exactly-once แบบ end-to-end ถ้าใช้ source ที่ replay ได้และ sink แบบ idempotent | at least once: ต้องทำ function ให้ idempotent |
| ใครรัน | เรา (Kubernetes, YARN หรือ standalone), Amazon Managed Service for Apache Flink, Confluent Cloud | เรา เป็นส่วนหนึ่งของ service | เรา หรือ managed Spark platform อย่าง Amazon EMR | AWS |

ตัวเลขจากเอกสารของ Flink 2.3, Kafka 4.3, Spark 4.2 และ AWS Lambda เดือนตุลาคม 2026

## ได้อะไร เสียอะไร

- **เป็น distributed system ที่ต้องดูแล** setup ใน production หมายถึง high availability ของ JobManager, TaskManager, storage สำหรับ checkpoint ที่ durable, การ upgrade และการวางแผน capacity ส่วน managed service รับเรื่องเครื่องไป แต่ไม่ได้รับเรื่อง design: key, ขนาด state, watermark และความ compatible ตอน upgrade ยังเป็นของเรา
- **ขนาด state กำหนดเวลา recover** checkpoint ต้อง upload state และการ restore ต้อง download มัน ทำให้ job ที่ state ใหญ่ทำ checkpoint ช้า และใช้เวลานานกว่าจะ restart หรือ rescale เสร็จ ตัว incremental checkpoint ช่วยเรื่องแรก ส่วน disaggregated state (ยังเป็น experimental ใน 2.3) มุ่งแก้เรื่องที่สอง
- **backpressure กลายเป็น lag** sink ที่ช้า subtask ที่รับงานเกิน หรือ hot key ทำให้ operator ต้นทางของมันช้าลง จนกระทั่ง source อ่านช้ากว่าที่ Kafka เติมเข้ามา แล้ว consumer lag ก็โตขึ้น aligned checkpoint ก็ช้าลงด้วย และ unaligned checkpoint ก็มีไว้แก้เรื่องนี้
- **การ upgrade คือการ migrate state** job เวอร์ชันใหม่ต้องอ่าน state ของเวอร์ชันเก่าได้: operator ID ที่คงที่, type ของ state ที่ compatible และ savepoint ทุกครั้งที่เปลี่ยน ส่วนการย้ายจาก 1.x ไป 2.x คือการ migrate จริง ๆ
- **latency แลกกับความครบถ้วน** ขอบเขตของ watermark ที่ใหญ่ขึ้นให้ event ที่มาช้าถูกนับได้มากขึ้น แต่ก็ทำให้ทุกผลลัพธ์ช้าลงเท่ากับขอบเขตนั้น ส่วน allowed lateness ก็เก็บ state ของ window ไว้นานขึ้น และ output แบบ exactly-once ก็ทำให้มองเห็นผลได้ช้าลงจนถึง checkpoint ถัดไป
- **connector ตาม release ไม่ทัน** การ upgrade Flink อาจต้องรอ connector ที่เราใช้ อย่าง Kafka connector สำหรับ 2.3 ณ ตุลาคม 2026

## ข้อควรรู้ตอนลงมือทำ

- **ให้ operator ที่มี state ทุกตัวมี `uid(...)` และตั้ง maximum parallelism ให้ชัด** (`setMaxParallelism(...)` หรือ `pipeline.max-parallelism`) ก่อน deploy ครั้งแรก เพราะทั้งสองอย่างเปลี่ยนทีหลังไม่ได้ถ้าไม่ยอมเสีย state
- **เลือก state backend ตามขนาด state:** `hashmap` สำหรับ state เล็ก ส่วน `rocksdb` คู่กับ `execution.checkpointing.incremental: true` สำหรับ state ใหญ่ ส่วน ForSt ยังเป็น experimental ใน Flink 2.3
- **เก็บ checkpoint บน storage ที่ durable** path `s3://` ต้องใช้ S3 file system plugin ตัวใดตัวหนึ่งของ Flink (`flink-s3-fs-presto` หรือ `flink-s3-fs-hadoop` ใน `plugins/` หรือ native implementation ที่ยังเป็น experimental ใน 2.3)
- **กำหนด watermark ที่ source** เพื่อให้ Kafka source ติดตามมันต่อ partition แล้วเพิ่ม `withIdleness(...)` ถ้า partition อาจเงียบไป เลือกขอบเขตจากความช้าที่วัดได้จริง และส่งข้อมูลที่มาช้าไปที่ side output จะได้เห็นว่ามีเยอะแค่ไหน
- **ให้ keyed state หมดอายุ** ด้วย `StateTtlConfig` เมื่อ key ไม่มีขอบเขต (บัตร, session, อุปกรณ์) ไม่อย่างนั้น state จะโตอย่างเดียว
- **ปรับ checkpoint ให้เหมาะกับ job** คอยดูระยะเวลาและขนาดของ checkpoint ตั้ง interval ให้มากกว่าระยะเวลาไปเยอะ ๆ และรู้ค่า default ไว้: checkpoint จะ timeout หลัง 10 นาที (`execution.checkpointing.timeout`) และถ้าใช้ `execution.checkpointing.tolerable-failed-checkpoints: 0` ตัว checkpoint ที่ fail หรือ timeout จะทำให้ job failover แล้ว restart ส่วนถ้า backpressure ทำให้ checkpoint ค้าง ก็ให้เปิด unaligned checkpoint
- **คอยดู backpressure และ lag** web UI ให้คะแนนแต่ละ subtask จาก `backPressuredTimeMsPerSecond` (OK ไม่เกิน 10 %, LOW ไม่เกิน 50 %, HIGH ถ้าเกินนั้น) และ Kafka source ก็รายงาน `pendingRecords` กับ `watermarkLag`
- **ถ้าจะทำ exactly-once ไปที่ Kafka** ใช้ `transactionalIdPrefix` ที่ไม่ซ้ำกันต่อ job เพิ่ม `transaction.timeout.ms` ให้เกินระยะเวลา checkpoint บวกเวลา restart และให้คนอ่าน output topic ทุกตัวใช้ `read_committed`
- **upgrade ผ่าน savepoint:** `bin/flink stop --savepointPath ...` แล้วเริ่มเวอร์ชันใหม่ด้วย `-s` ส่วนถ้าใช้ Kubernetes Operator ตัว `upgradeMode: savepoint` จะทำทั้งสองขั้นให้
