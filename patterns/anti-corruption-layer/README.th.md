## ปัญหา

service ใหม่ไม่ค่อยได้เริ่มต้นแบบตัวคนเดียว มันต้องใช้ข้อมูลและพฤติกรรมที่ยังอยู่ในระบบ legacy, packaged product หรือ API ของ partner และระบบนั้นก็มี model เป็นของตัวเอง: record แบบ `CUST_MST`, `STAT_CD = A`, key ที่เติมศูนย์ข้างหน้า, interface ที่เป็น SOAP envelope หรือไฟล์ fixed-width ถ้าโค้ดใหม่เรียกมันตรง ๆ คำศัพท์พวกนั้นก็ย้ายเข้ามาด้วย ชื่อ field ของ legacy โผล่ใน class ของ service ใหม่ รหัสของ legacy โผล่ในคำสั่ง `if` และรูปแบบของ legacy ก็โผล่ในคอลัมน์ของ database ตอนนี้ model ใหม่มีหน้าตาตาม model เก่าไปแล้ว สองระบบต้องเปลี่ยนไปพร้อมกันเท่านั้น และทุกการอัปเกรดฝั่ง legacy ก็เป็นความเสี่ยงของฝั่งใหม่

## ทำงานยังไง

pattern นี้มาจาก *Domain-Driven Design* (2003) ของ Eric Evans ที่มันเป็นหนึ่งในความสัมพันธ์ที่ **bounded context** สองตัวมีต่อกันได้บน context map: ทีม downstream ที่ต้องใช้อีกระบบหนึ่ง แต่ไม่ต้องการ model ของระบบนั้น จะสร้าง layer มาคั่นแยก แล้วคุยกับอีกระบบผ่าน layer นั้นเท่านั้น (ชื่อนี้มักถูกย่อเป็น ACL และไม่เกี่ยวอะไรกับ access control list)

layer นี้มีหน้าที่สามอย่าง ปกติก็แบ่งเป็นสามส่วนเล็ก ๆ

- **Adapter**: implement interface ที่ service ใหม่ต้องการ ด้วยภาษาของ model ใหม่ (`getCustomer(id)` คืนค่าเป็น `Customer`) โดยส่ง request ที่เทียบเท่ากันไปที่ระบบ legacy มันเป็นส่วนเดียวที่ service ใหม่เคยเห็น และมีให้แค่สิ่งที่ service นั้นต้องใช้ ไม่ใช่ทุกอย่างที่ระบบ legacy ทำได้
- **Translator**: แปลงสิ่งที่ข้ามรอยต่อ ทั้งสองทิศ: ชื่อ (`CUST_NO` กลายเป็น `id`), โครงสร้าง (`NM_FRST` กับ `NM_LAST` กลายเป็น `name`), รหัส (`STAT_CD = A` กลายเป็น `ACTIVE`), รูปแบบ หน่วย และ error
- **Facade**: หน้าบ้านที่ง่ายกว่าสำหรับ interface ของ legacy แต่ยังใช้ภาษาของระบบ legacy เอง: เรียกครั้งเดียวแบบธรรมดา แทนที่จะต้องไล่ SOAP envelope, session และ paging เป็นลำดับ มันไม่แปลอะไรเลย และระบบ legacy ที่ interface ง่ายอยู่แล้วก็ไม่ต้องมี facade

(Azure และ AWS ใช้คำว่า *facade* และ *adapter* แบบหลวม ๆ กว่านี้ หมายถึง layer ทั้งก้อน)

service ใหม่เห็นแค่ model ของตัวเอง ระบบ legacy ไม่ถูกแก้อะไรเลย และ layer ก็เป็นที่เดียวที่รู้จักทั้งสองฝั่ง พอฝั่ง legacy เปลี่ยนรหัสหรือรูปแบบ ก็แก้แค่ mapping เดียว ส่วน domain ไม่ต้องเปลี่ยน

ไอเดียเดียวกันนี้ใช้ได้ทุกทิศ

- **ระบบใหม่เรียก legacy** (ในไดอะแกรม): layer ยืนอยู่หน้าระบบ legacy
- **Legacy เรียกระบบใหม่**: พอแยก capability หนึ่งออกมาแล้ว ส่วนที่เหลือของ monolith ก็ยังเรียกมันแบบเดิม คำแนะนำของ AWS แสดง layer ไว้ *ข้างใน monolith* เป็น class ที่อยู่หลัง interface เดิม ตัวเรียกที่มีอยู่เลยไม่ต้องแตะเลย ในขณะที่ layer แปลไปเป็น API ของ service ใหม่
- **Event และ data feed**: consumer ที่แปลง message ของ legacy, แถวจาก change data capture หรือไฟล์ที่มาทุกคืน ให้เป็น domain event ก็เป็น anti-corruption layer เหมือนกัน ให้ publish `CustomerActivated` ไม่ใช่สำเนาของแถวที่เปลี่ยน

## ใช้ตอนไหนดี

- งาน migration ที่กินเวลาหลาย release และระหว่างนั้น service ใหม่ต้องทำงานกับระบบ legacy ไปด้วย มันมักมาคู่กับ [strangler fig](../strangler-fig/)
- การ integrate กับระบบของ third party, partner หรือ packaged system ที่คุณไม่ได้คุม model และไม่อยากให้ model นั้นเข้ามาอยู่ในโค้ด
- context ฝั่ง downstream เป็นหัวใจของธุรกิจ model ของมันเลยคุ้มที่จะปกป้อง

context map ของ Evans ยังมีคำตอบแบบอื่นด้วย และคุ้มที่จะดูก่อนจะลงมือสร้าง layer

- **Conformist**: รับ model ของ upstream มาใช้ตามที่เป็น ไม่แปลอะไรเลย เหมาะตอนที่ model นั้นดีพออยู่แล้ว หรือการ integrate เล็กเกินกว่าจะคุ้มกับการมี layer
- **Open host service with a published language**: ฝั่ง *upstream* มี API ที่สะอาดและมีเอกสารให้ตัวเดียว พร้อมรูปแบบข้อมูลที่ใช้ร่วมกันสำหรับ consumer ทุกตัว เหมาะตอนที่คุณเป็นเจ้าของหรือมีอิทธิพลต่อระบบ upstream ได้ หรือตอนที่มันมี consumer เยอะ: แก้ model ครั้งเดียวที่ต้นทาง แทนที่จะแก้ครั้งละ consumer
- **Separate ways**: ไม่ integrate เลย เหมาะตอนที่การ integrate จะแพงกว่าคุณค่าของ feature

อย่าใช้ anti-corruption layer ตอนที่สอง model ใกล้กันอยู่แล้ว (ไม่มีอะไรให้แปล ทำให้ layer เป็นแค่ hop เพิ่ม) หรือตอนที่การ conform ก็แค่ถูกกว่า

## ได้อะไร เสียอะไร

- **Latency** ทุกการเรียกต้องจ่ายค่าแปล และถ้า layer เป็น service แยก ก็ต้องจ่ายค่า network hop ด้วย ให้ตั้ง latency budget ไว้ แล้วเทสต์เทียบกับมันก่อนขึ้น production
- **มีของต้องรันเพิ่มอีกตัว** layer ที่แยกออกมาต้องมี pipeline, configuration, monitoring และ alerting ของตัวเอง เหมือน service อื่น ๆ
- **Scaling และ availability** layer ต้อง scale ตามตัวเรียก ไม่อย่างนั้นมันจะกลายเป็นคอขวด และตอนที่มันล่ม ระบบ legacy ก็เข้าถึงไม่ได้ ใส่ timeout, [retry](../retry-with-backoff/) และ [circuit breaker](../circuit-breaker/) ให้การเรียกของมัน
- **Consistency** การแปลไม่ได้ทำให้สองระบบ consistent กัน operation ที่เขียนทั้งสองฝั่งยังต้องมีการเรียกแบบ idempotent และ compensation (แบบ [saga](../saga-orchestration/)) และต้องมีคนคอยดู drift
- **Mapping ที่ทำข้อมูลหาย** model ไม่เคยตรงกันพอดี ตัดสินใจให้ชัดว่าจะทิ้งอะไร ใช้ค่า default กับอะไร หรือปฏิเสธอะไร เพราะ layer คือที่ที่การตัดสินใจพวกนั้นไปลงเอย
- **ของชั่วคราวมักกลายเป็นของถาวร** ถ้า layer มีอยู่แค่เพื่องาน migration ให้บันทึกไว้เป็นหนี้ที่มีเจ้าของ แล้วลบทิ้งเมื่อตัวเรียกตัวสุดท้ายย้ายออกไปแล้ว

## ข้อควรรู้ตอนลงมือทำ

- **อยู่ที่ไหน** เป็น module ข้างใน service ใหม่: ถูกที่สุด ไม่มี network hop และใช้ได้ดีถ้ามี consumer ตัวเดียว ส่วนแบบที่เป็น service แยกของตัวเอง (อย่างในภาพ): ตอนที่หลาย service ต้องใช้ capability เดียวกันของ legacy หรือ protocol ของ legacy ต้องการตำแหน่งใน network หรือ runtime แบบพิเศษ แล้วแบบที่อยู่ข้างใน legacy monolith: ตอนที่โค้ด legacy เป็นตัวเรียก
- **หนึ่ง layer ต่อหนึ่ง upstream context** "integration layer" ตัวเดียวที่ใช้ร่วมกันสำหรับทุกอย่าง จะกลายเป็นคอขวดและเป็น dependency ของทุกทีม ทำ layer เล็ก ๆ หนึ่งตัวต่อหนึ่งระบบ upstream และให้ทีมที่ใช้มันเป็นเจ้าของ
- **อะไรควรอยู่ในนั้น:** การแปลชื่อ โครงสร้าง รหัส และหน่วย, การปรับ protocol, การ map fault ของ legacy ไปเป็น domain error, การ validate สิ่งที่ส่งกลับมา และบางทีก็ cache สำหรับการ lookup ที่ช้าหรือโดน rate limit **อะไรไม่ควรอยู่:** business rule และ orchestration ส่วน rule ที่ดูเหมือนต้องใช้ทั้งสอง model ควรอยู่ใน domain และทำงานกับข้อมูลที่แปลแล้ว
- **เจอของที่ไม่รู้จักให้พังเสียงดัง** รหัสที่ mapping ไม่เคยเห็น (`STAT_CD = 07`) ควรโยน error และยิง alert ไม่ใช่ปล่อยผ่านไปเป็น string หรือถอยไปใช้ค่า default
- **เทสต์ mapping** ด้วย response ของ legacy ที่บันทึกไว้ และด้วย contract test กับ interface ของ legacy การเปลี่ยนฝั่ง legacy จะได้โผล่มาเป็นเทสต์ที่ fail ใน layer แทนที่จะเป็นข้อมูลเสียใน domain
- **เฝ้าดูมัน** ส่ง correlation ID ข้าม hop ไปด้วย ([distributed tracing](../distributed-tracing/)) log การแปลที่ล้มเหลวในรูปแบบ structured และติดตาม latency กับ error rate ของแต่ละ operation ฝั่ง legacy
- **Hexagonal architecture** ในภาษาของ ports-and-adapters ตัว domain เป็นเจ้าของ port ที่ใช้ภาษาของตัวเอง (`CustomerDirectory`) และ anti-corruption layer ก็คือ adapter ที่อยู่หลัง port นั้น ส่วน adapter ธรรมดาซ่อนเทคโนโลยี แต่ตัวนี้ซ่อน model แปลกหน้าไว้ด้วย
- **Strangler fig** ตัว strangler facade ตัดสินว่า *ระบบไหน* จะรับ request ส่วน anti-corruption layer ตัดสินว่า *ข้อมูลหมายถึงอะไร* ตอนที่ service ใหม่ยังต้องพึ่งตัวเก่า งาน migration ปกติต้องใช้ทั้งคู่ และ layer ก็หายไปเมื่อ capability ที่อยู่ข้างหลังมันย้ายไปแล้ว
- **เป็นตัวอย่าง ไม่ใช่ข้อบังคับ:** ตัวอย่างของ Azure วาง Azure API Management ไว้ข้างหน้าเพื่อดูแลเรื่องการเปิดให้เรียกและเรื่อง protocol แล้วทำ mapping ใน Azure Functions ส่วนตัวอย่างของ AWS เก็บ layer ไว้เป็น class ใน ASP.NET monolith ที่เรียก service ที่แยกออกมา (Lambda function) ผ่าน Amazon API Gateway ส่วนฝั่ง feed การแปลแบบเดียวกันก็รันใน consumer ของ queue หรือ stream
