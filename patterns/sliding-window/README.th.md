## ปัญหา

คำถามเกี่ยวกับลำดับข้อมูลหลายข้อ จริง ๆ แล้วเป็นคำถามเกี่ยวกับทุกช่วงของตัวที่อยู่ติดกัน: ยอดขายรวมที่ดีที่สุดของช่วง 7 วันไหนก็ได้ ช่วงที่ยาวที่สุดของ string ที่ไม่มีตัวอักษรซ้ำ หรือ client ส่ง request มากี่ตัวในนาทีที่ผ่านมา คำตอบที่เห็นได้ชัดคือคำนวณแต่ละช่วงใหม่ตั้งแต่ต้น ถ้ามีข้อมูล n ตัวและช่วงยาว k ตัว งานก็ราว n·k และเกือบทั้งหมดเป็นการทำงานที่เพิ่งทำไปซ้ำอีกรอบ เพราะสองช่วงที่อยู่ติดกันต่างกันแค่ตัวที่ปลายแต่ละข้าง ถ้ามีข้อมูลล้านตัวกับ k = 1,000 การนับใหม่ต้องบวกราวพันล้านครั้ง เพื่อให้ได้คำตอบที่แต่ละตัวต่างจากตัวก่อนหน้าแค่สองตัว

## ทำงานยังไง

เก็บ **window** ไว้ คือตัวที่อยู่ระหว่าง index `left` กับ `right` พร้อมสรุปของสิ่งที่อยู่ข้างใน (ผลรวม จำนวน หรือตารางตัวอักษร) แล้วเลื่อน window ไปแทนที่จะสร้างใหม่

- **Window ขนาดคงที่** ขยับขอบทั้งสองข้างไปพร้อมกัน รวม window แรกแค่ครั้งเดียว หลังจากนั้นแต่ละก้าวก็บวกตัวที่เข้ามาทางขวาแล้วลบตัวที่ออกไปทางซ้าย แต่ละตัวถูกอ่านไม่เกินสองครั้ง คือตอนเข้าครั้งหนึ่งกับตอนออกครั้งหนึ่ง ทั้งรอบเลยอ่าน k + 2(n − k) ครั้ง: เป็น O(n) ไม่ว่า k จะเท่าไร
- **Window ขนาดเปลี่ยนได้** ขยับขอบแต่ละข้างแยกกัน `right` เดินไปทีละตัวเพื่อขยาย window ถ้า window ผิดกฎ (มีตัวอักษรซ้ำ หรือผลรวมเกินงบ) `left` ก็เดินไปจนกฎกลับมาเป็นจริง ขอบทั้งสองข้างไม่เคยถอยหลัง แต่ละตัวเลยเข้ามาครั้งเดียวและออกไม่เกินครั้งเดียว ก็เป็น O(n) เหมือนกัน แม้ว่า `right` ขยับก้าวเดียวแล้วทำให้ `left` เดินไปข้างหน้าหลายช่องก็ตาม

วิธีนี้ใช้ได้ภายใต้สองเงื่อนไข:

1. **สรุปต้องอัปเดตได้ใน O(1) ตอนที่ตัวเข้าและออก** ผลรวมกับจำนวนลบออกได้ง่าย ๆ ส่วนตารางนับตัวอักษรก็เปลี่ยนแค่ช่องเดียวต่อการขยับหนึ่งครั้ง แต่ค่าสูงสุดทำแบบนี้ไม่ได้ ถ้าตัวที่ใหญ่ที่สุดออกไป ค่าเดียวที่เก็บไว้บอกไม่ได้ว่าตัวที่ใหญ่รองลงมาคืออะไร ทางแก้มาตรฐานคือ **monotonic deque** ของ index ที่ค่าลดลงจากหน้าไปหลัง ก่อนจะต่อ index ใหม่ ให้ pop ค่าที่เล็กกว่าออกจากท้าย (ตราบที่ตัวใหม่ยังอยู่ใน window พวกมันไม่มีทางเป็นค่าสูงสุดได้) แล้ว pop ตัวหน้าออกเมื่อมันเลื่อนหลุด window ไป แต่ละ index ถูก push ครั้งเดียวและ pop ไม่เกินครั้งเดียว ค่าสูงสุดของทุก window เลยรวมกันแค่ O(n) ตัว `collections.deque` ของ Python ต่อท้ายและ pop ได้ทั้งสองปลายใน O(1)
2. **Window ขนาดเปลี่ยนได้ต้องมีกฎที่มีแต่จะแย่ลงเมื่อ window โตขึ้น** "มีตัวอักษรซ้ำ" ยังเป็นจริงต่อไปเมื่อเพิ่มตัวอักษรเข้าไป และ "ผลรวมอย่างน้อย S" ก็ยังเป็นจริงเมื่อเพิ่มตัวเลขที่ไม่ติดลบ ทางเดียวที่มีประโยชน์เลยคือขยับ `left` ตัวเลขติดลบทำให้เงื่อนไขนี้พัง ถ้าจะหาช่วงที่สั้นที่สุดของ `[1, −1, 5]` ที่รวมได้อย่างน้อย 5 ก็จะเห็นว่า window ที่หดเข้ามาไปถึงทั้ง array แล้วทิ้ง 1 ออก แล้วพบว่า `[−1, 5]` รวมได้แค่ 4 ก็หยุด มันเลยตอบ 3 ทั้งที่ `[5]` ตัวเดียวก็ถึง 5 แล้ว ปัญหาแบบนี้ต้องใช้ prefix sum แทน: hash map ของผลรวมสะสมนับช่วงที่รวมได้เท่ากับ target พอดีได้ในรอบเดียว รวมตัวติดลบด้วย (การค้นหานี้ก็คือ [Hash Table](../hash-table/) ทำงานอยู่) ส่วนช่วงที่สั้นที่สุดที่รวมได้อย่างน้อย S หาได้ด้วย prefix sum กับ monotonic deque

ปัญหาที่เจอบ่อย: ผลรวมหรือค่าเฉลี่ยที่ดีที่สุดของ k ตัวที่อยู่ติดกัน substring ที่ยาวที่สุดที่ไม่มีตัวอักษรซ้ำ ช่วงที่เล็กที่สุดที่ไปถึง target และการหา anagram ของคำหนึ่งในข้อความ โดยเลื่อน window ที่ยาวเท่าคำนั้นแล้วเทียบจำนวนตัวอักษร เทคนิค Two Pointers ที่ใกล้เคียงกันจะเทียบสองตัวที่ pointer ชี้อยู่ (เช่นคู่ที่รวมได้เท่ากับ target) ส่วนใน sliding window ทุกตัวระหว่างขอบทั้งสองข้างนับหมด

## โค้ด

```python
from collections import deque


def max_window_sum(a, k):
    """Return the largest sum of k neighbouring items in a."""
    if not 1 <= k <= len(a):
        raise ValueError("need 1 <= k <= len(a)")
    window = sum(a[:k])                       # the first window, added up once
    best = window
    for right in range(k, len(a)):
        window += a[right] - a[right - k]     # add the item that enters, drop the one that leaves
        best = max(best, window)
    return best


def longest_unique(s):
    """Return (length, substring) for the longest stretch of s with no repeated character."""
    last = {}                                 # character -> index where it was last seen
    left = best_left = best_len = 0
    for right, ch in enumerate(s):
        if last.get(ch, -1) >= left:          # ch is already inside the window
            left = last[ch] + 1               # jump past its earlier copy
        last[ch] = right
        if right - left + 1 > best_len:
            best_len, best_left = right - left + 1, left
    return best_len, s[best_left:best_left + best_len]


class SlidingWindowLimiter:
    """Accept at most `limit` requests in any `window` seconds (a sliding log)."""

    def __init__(self, limit, window):
        self.limit, self.window = limit, window
        self.log = deque()                    # times of accepted requests, oldest first

    def allow(self, now):
        while self.log and self.log[0] <= now - self.window:
            self.log.popleft()                # older than the window: forget it
        if len(self.log) < self.limit:
            self.log.append(now)
            return True
        return False


print(max_window_sum([4, 2, 7, 1, 8, 3, 5, 6, 2, 9], 3))   # 17
print(longest_unique("datastream"))                       # (6, 'stream')
limiter = SlidingWindowLimiter(limit=5, window=60)
print([limiter.allow(t) for t in (0, 8, 15, 22, 40, 52, 61, 70)])
# [True, True, True, True, True, False, True, True]
```

การเช็ก `last.get(ch, -1) >= left` สำคัญ: ใน `abba` ตัว `a` สุดท้ายถูกเห็นล่าสุดที่ index 0 และตอนนี้ index นั้นอยู่นอก window ไปแล้ว `left` เลยต้องอยู่ที่ 2 ไม่ใช่กระโดดกลับไปที่ 1 ตัว limiter เก็บแค่ request ที่รับไว้ ทำให้ client ที่ retry ไม่หยุดตอนโดนจำกัดไม่โดนล็อกนานขึ้นเพราะความพยายามที่โดนปฏิเสธของตัวเอง และ timestamp ที่เก่า 60 วินาทีพอดีก็หลุดออกจาก window ไปแล้ว

ทั้งสามตัวทดสอบเทียบกับ brute force แล้ว: `max_window_sum` กับ list สุ่ม 20,000 ชุดที่มีตัวเลขติดลบ สำหรับ k = 1, k = n และ k สุ่มที่อยู่ระหว่างนั้น รวมถึง k = 0 และ k > n ที่ไม่ถูกต้อง ส่วน `longest_unique` กับ string สุ่ม 20,000 ตัวที่ใช้ตัวอักษรหนึ่งถึงสี่ตัว รวมถึง string ว่าง ตัวอักษรตัวเดียว ตัวอักษรเหมือนกันหมด `abba` และ `pwwkew` และ limiter กับ timestamp ข้างบนและกับ request stream สุ่ม 5,000 ชุด เทียบกับ log ที่สแกนใหม่ทุก request

## Complexity

| | Time | พื้นที่เพิ่ม | ทำไม |
|---|---|---|---|
| นับใหม่ทุก window | O(n·k) | O(1) | window ทั้ง n − k + 1 อันต่างก็อ่าน k ตัวของตัวเอง |
| Window ขนาดคงที่ แบบเลื่อน | O(n) ทั้ง best, average และ worst case | O(1) | อ่าน k ครั้งสำหรับ window แรก แล้ว 2 ครั้งต่อการเลื่อน: รวม k + 2(n − k) |
| Window ขนาดเปลี่ยนได้ (`longest_unique`) | O(n) ทั้ง best, average และ worst case โดยที่ operation ของ dictionary เป็น O(1) โดยเฉลี่ย | O(min(n, ขนาด alphabet)) | `right` ไปที่แต่ละ index ครั้งเดียว และ `left` ขยับแค่ไปข้างหน้า ถ้าใช้ array ที่ index ด้วยรหัสตัวอักษรแทน dictionary ทุกการค้นหาจะเป็น O(1) แม้ใน worst case ส่วนตารางเก็บหนึ่งช่องต่อตัวอักษรที่ไม่ซ้ำกัน |
| Limiter แบบ sliding log | O(1) amortized ต่อ request | O(limit) ต่อ client | แต่ละ timestamp ถูกต่อท้ายครั้งเดียวและ pop ไม่เกินครั้งเดียว request ตัวเดียวอาจ pop ของเก่าได้ถึง `limit` ตัวหลังช่วงที่เงียบไป และเก็บแค่ request ที่รับไว้ |

ไม่มีการเรียงหรือจัดลำดับใหม่ เรื่อง stable และ in place เลยไม่เกี่ยว

## ใช้ตอนไหนดี

- คำถามเกี่ยวกับทุกช่วงของ k ตัวที่อยู่ติดกัน: moving sum และ moving average ช่วง k วันที่ดีที่สุด สถิติแบบ rolling ในการ monitor
- ช่วงที่ยาวที่สุดหรือสั้นที่สุดที่ตรงตามกฎที่มีแต่จะแย่ลงเมื่อช่วงโตขึ้น: ไม่มีตัวซ้ำ มีค่าที่ไม่ซ้ำกันไม่เกิน k ค่า ไม่เกินงบ หรือค่าที่ไม่ติดลบรวมจนถึง target
- Stream ที่สนใจแค่ข้อมูลล่าสุด: rate limit, error rate ล่าสุด, "N event ล่าสุด" และการตัดตัวซ้ำภายในช่วงเวลาหนึ่ง
- ไม่เหมาะกับตัวที่ไม่ต้องอยู่ติดกัน (นั่นเป็นปัญหา subset หรือ subsequence) ไม่เหมาะเมื่อสรุปอัปเดตทีละนิดไม่ได้ (median ของทุก window ต้องใช้โครงสร้างที่เรียงลำดับ เช่น balanced search tree ที่ใช้งาน O(log k) ต่อการเลื่อน) และไม่เหมาะกับผลรวมที่มีตัวเลขติดลบภายใต้กฎที่ไม่ monotonic: ให้ใช้ prefix sum

## ได้อะไร เสียอะไร

- **สรุปต้องลบออกได้** ผลรวมกับจำนวนทำง่าย ค่าสูงสุดและต่ำสุดต้องใช้ monotonic deque ส่วน median และ percentile ต้องใช้โครงสร้างที่เรียงลำดับ เช่น balanced tree ผลรวมสะสมแบบ floating-point ยังสะสม rounding error ไปตลอดการบวกลบหลายล้านครั้ง เลยควรเก็บเป็นหน่วยจำนวนเต็ม (สตางค์ มิลลิวินาที) หรือคำนวณใหม่ตั้งแต่ต้นเป็นครั้งคราว
- **Window ขนาดเปลี่ยนได้ต้องมีกฎแบบ monotone** รอบนี้จะถูกก็ต่อเมื่อการขยาย window ไม่มีทางทำให้กฎที่พังไปแล้วกลับมาเป็นจริงได้ ไม่อย่างนั้นให้เปลี่ยนไปใช้ prefix sum
- **Time window แบบแม่นยำเปลือง memory ต่อ event** sliding log เก็บหนึ่ง timestamp ต่อ request ที่รับไว้: แม่นยำ แต่ memory โตตาม limit และจำนวน client บทความของ Cloudflare อธิบาย **sliding window counter** ที่ถูกกว่า: เก็บแค่จำนวนของ window นี้กับของ window ก่อนหน้า แล้วถ่วงน้ำหนักตัวก่อนหน้าตามส่วนที่ยังทับกับ 60 วินาทีล่าสุดอยู่ ถ้านาทีก่อนมี 42 request และตอนนี้มี 18 ตัว ผ่านนาทีปัจจุบันมา 15 วินาที ค่าประมาณคือ 42 × 45/60 + 18 = 49.5 วิธีนี้สมมติว่า request ของนาทีก่อนกระจายตัวเท่า ๆ กัน และกับ request 400 ล้านตัวจาก 270,000 แหล่ง Cloudflare วัดได้ว่ารับหรือจำกัดผิดไป 0.003% ส่วน **token bucket** (ตัวที่อยู่ใน [Rate Limiting](../rate-limiting/)) ก็เก็บแค่สองค่าเหมือนกัน แต่ตั้งใจยอมให้มี burst ที่สะสมไว้ ส่วน sliding log ไม่เคยรับเกิน limit ในช่วง 60 วินาทีไหนเลย
- **Stream บังคับให้เลือกรูปแบบของ window** Tumbling window (ขนาดคงที่ ไม่ทับกัน) ถูก แต่จะแบ่ง burst ที่คร่อมขอบออกเป็นสองส่วน Window ที่ทับกัน (ขนาดคงที่ เลื่อนทีละก้าวที่สั้นกว่า) มีโอกาสเห็น burst แบบนั้นเป็นก้อนเดียวมากกว่า แต่แต่ละ event อยู่ในหลาย window: 12 อันสำหรับ window 1 ชั่วโมงที่เลื่อนทุก 5 นาที ส่วน session window จะปิดหลังจากช่วงที่ไม่มี event เลย

## ข้อควรรู้ตอนลงมือทำ

- **Stream processing** DataStream API ของ Apache Flink มี window assigner แบบ tumbling, sliding, session และ global ตัว sliding window ของมันมี size กับ slide และจะทับกันเมื่อ slide สั้นกว่า คำแนะนำเรื่องขนาดของ Flink คือแต่ละ element ถูกเก็บหนึ่งครั้งต่อทุก window ที่มันอยู่ และ `ReduceFunction` หรือ `AggregateFunction` แบบ incremental ช่วยลดเหลือค่าเดียวต่อ window ส่วน Kafka Streams เรียก window ขนาดคงที่ที่ทับกันแบบเดียวกันนี้ว่า **hopping** window และเก็บชื่อ **sliding** ไว้ใช้กับ window ที่นิยามด้วยระยะเวลาระหว่าง record ใช้กับ join (`JoinWindows`) และ aggregation (`SlidingWindows`) ตัว session window ของมันรวม event ที่มาห่างกันไม่เกิน inactivity gap เข้าด้วยกัน เช็กก่อนว่าเครื่องมือใช้ความหมายไหน แล้วค่อยย้าย query ไป
- **Rate limiter** sliding log ใส่ลง Redis sorted set ได้หนึ่งชุดต่อ client โดยใช้ timestamp เป็น score: [`ZREMRANGEBYSCORE`](https://redis.io/docs/latest/commands/zremrangebyscore/) ลบตัวที่เก่ากว่า window ทิ้ง `ZCARD` นับที่เหลือ และ `ZADD` บันทึก request ที่รับไว้ การเพิ่มกับการลบใช้อย่างละ O(log n) บวกอีกหนึ่งก้าวต่อตัวที่หมดอายุแล้วถูกลบ ส่วนการนับเป็น O(1) ให้รันทั้งสามคำสั่งเป็น Lua script ตัวเดียว การนับกับการเพิ่มจะได้ atomic และ request สองตัวที่มาพร้อมกันจะไม่แย่งที่สุดท้ายไปได้ทั้งคู่ ตัว edge limiter ของ Cloudflare ใช้วิธีประมาณแบบสอง counter แทน โดยอ่าน counter ของนาทีก่อนกับนาทีปัจจุบันด้วย cache request ครั้งเดียว ส่วน gateway หลายตัวมี token bucket หรือ leaky bucket ให้ใช้ ดูได้ใน [Rate Limiting](../rate-limiting/)
- **Circuit breaker** ตัว circuit breaker ของ Resilience4j คำนวณ failure rate บน sliding window จะเป็น N call ล่าสุด (circular array ของผลลัพธ์ N ตัว) หรือ N วินาทีล่าสุด (circular array ของ bucket ขนาดหนึ่งวินาที N อัน) ก็ได้ ทั้งสองแบบเก็บผลรวมสะสมไว้แล้วลบสิ่งที่หลุดออกจาก window การอ่าน failure rate เลยเป็น O(1) ไม่ว่า window จะใหญ่แค่ไหน ดู [Circuit Breaker](../circuit-breaker/)
- **Monitoring และ alerting** error rate ใน 5 นาทีล่าสุดหรือชั่วโมงล่าสุดก็คือ sliding window บน stream ของ event ตัว burn-rate alert แบบหลาย window จับคู่ window ยาวกับ window สั้นที่ยาวหนึ่งในสิบสองของมัน (ตามแนวทางของ Google SRE Workbook) alert เลยดังเฉพาะตอนที่ error budget ยังไหม้อยู่ และหยุดไม่นานหลังแก้แล้ว ดู [SLOs & Error Budgets](../slo-error-budgets/)
- **Rolling checksum** rsync เลื่อน checksum แบบอ่อนขนาด 32 bit ที่ได้แรงบันดาลใจจาก Adler-32 ไปตามไฟล์ทีละ byte: checksum ที่ offset ถัดไปได้มาจากตัวก่อนหน้าด้วยการเอา byte ที่ออกไปออก แล้วเพิ่ม byte ที่เข้ามา ทำให้หา block ที่อีกฝั่งมีอยู่แล้วเจอได้ที่ offset ไหนก็ได้ ไม่ใช่แค่ที่ผลคูณของขนาด block แล้ว checksum แบบแข็งก็ยืนยันแต่ละตัวที่ตรงกัน การค้นหา string แบบ Rabin–Karp ก็เลื่อน polynomial hash แบบเดียวกัน
- **TCP** ใน RFC 9293 ฝั่งรับจะประกาศ window คือช่วงของ sequence number ที่มันพร้อมรับ ตั้งใจให้ window นี้ตามพื้นที่ buffer ที่ว่างอยู่ ฝั่งส่งส่งได้ถึง byte ที่เก่าที่สุดที่ยังไม่ได้ ack บวกกับ window นั้น พอ ack มาถึง ช่วงนี้ก็เลื่อนไปข้างหน้าตาม byte stream และข้อมูลที่ค้างอยู่ระหว่างทาง (ส่งไปแล้วแต่ยังไม่ได้ ack) ไม่เคยเกินที่ฝั่งรับเสนอไว้ congestion control เพิ่มขีดจำกัดอีกชั้น: ใน [RFC 5681](https://www.rfc-editor.org/rfc/rfc5681.html) ค่าที่เล็กกว่าระหว่าง congestion window กับ window ของฝั่งรับเป็นตัวคุมการส่ง ก็เป็นภาพเดียวกันของช่วงที่มีขอบเขตเลื่อนไปข้างหน้าตามลำดับ แค่ทำบัญชีต่างกัน
- **Python** `collections.deque(maxlen=k)` เก็บ k ตัวล่าสุดและทิ้งตัวที่เก่าที่สุดเอง และเอกสารของ `deque` ก็มีสูตร moving average ที่เก็บผลรวมสะสมไว้ บวกค่าใหม่แต่ละตัวแล้วลบตัวที่หลุดออกไป
