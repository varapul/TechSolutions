## ปัญหา

production คือที่ที่ release ได้เจอ traffic จริง ข้อมูลจริง และ dependency จริงเป็นครั้งแรก ถ้าสลับทุก instance ไปเวอร์ชันใหม่พร้อมกัน (แบบ in-place หรือตัดเปลี่ยนทีเดียวแบบ blue-green) build ที่เสียก็จะไปถึง user ทุกคนในวินาทีเดียวกัน: ทุกความผิดพลาดมี blast radius 100%

## ทำงานยังไง

รันเวอร์ชันใหม่ไว้ข้าง ๆ เวอร์ชันเก่า ให้มันรับ traffic ส่วนเล็ก ๆ แล้วปล่อยให้ metric ของ production ตัดสินว่ามันจะได้เพิ่มหรือไม่ ชื่อนี้มาจากนกขมิ้น (canary) ที่คนงานเหมืองพกไว้เป็นสัญญาณเตือนล่วงหน้า

- **router** แบ่ง traffic ตามน้ำหนัก: load balancer ที่มี weighted target, ingress controller, API gateway หรือ service mesh น้ำหนักจะเป็นไปตามตารางที่ตกลงกันไว้ล่วงหน้า เช่น 5% → 25% → 50% → 100%
- ในทุกขั้น **การวิเคราะห์อัตโนมัติ** จะเทียบ v2 กับ v1 ด้วย metric ไม่กี่ตัวที่ user รู้สึกได้ (error rate, latency percentile, saturation และ business signal อีกหนึ่งหรือสองตัว) แล้วคืนผลว่าผ่านหรือไม่ผ่าน
- **ผ่าน** ก็ขยับไปน้ำหนักถัดไป หลังขั้นสุดท้าย v2 ก็กลายเป็นเวอร์ชันที่เสถียร และ v1 ก็ถูก scale down **ไม่ผ่าน** ก็ตั้งน้ำหนักของ v2 กลับเป็น 0% แล้ว v1 ที่ไม่เคยหยุดรันเลยก็กลับมารับทุกคนอีกครั้ง

**ใครได้ไป canary** สุ่ม request ส่วนหนึ่งเป็นทางที่ง่ายที่สุดและเป็นตัวแทนได้ดีที่สุด การส่ง user ภายในไปก่อน ("dogfooding") จับของพังที่เห็นชัด ๆ ได้ก่อนลูกค้าจะเห็น การใช้ region, zone หรือ cell เดียวทำให้ canary อยู่ใน fault domain เดียว แบบเดียวกับที่ platform ใหญ่ ๆ rollout เป็นระลอก ให้การแบ่งกลุ่ม **sticky** ด้วยการ hash key ที่คงที่ (user ID, session cookie, tenant) ลงไปเป็น bucket 0–99 แล้วส่ง bucket ที่ต่ำกว่าน้ำหนักไปที่ v2 แบบนี้ user จะอยู่กับเวอร์ชันเดียวตลอดทั้ง session และตอนเพิ่มน้ำหนักจาก 5% เป็น 25% กลุ่ม 5% แรกก็ยังอยู่บน v2 ไม่ต้องสับทุกคนใหม่

**สัญญาณต้องพอ** canary 1% บน service ที่รับ 10 request ต่อวินาทีจะเห็นราว 6 request ต่อนาที ที่ error rate 0.5% ก็ตกประมาณหนึ่ง error ทุกครึ่งชั่วโมง น้อยเกินไปมากที่จะแยก regression ออกจาก noise ได้ ให้ตั้งน้ำหนักและระยะเวลาของแต่ละขั้นให้ทุก metric เก็บตัวอย่างได้พอ (Spinnaker แนะนำอย่างน้อย 50 data point ต่อ metric) และให้ช่วงเวลาครอบคลุมชั่วโมง peak, การ warm cache และ scheduled job

**มี baseline ไม่ใช่แค่ threshold** limit ตายตัวอย่าง "error rate ต่ำกว่า 1%" จับ outage ได้ แต่พลาด regression ที่ยังไม่เกิน limit และยังดังตอนที่ v1 มีปัญหาด้วย ให้เทียบ canary กับ baseline ในช่วงเวลา*เดียวกัน*แทน: การเทียบก่อน/หลังจะเพี้ยนเพราะช่วงเวลาของวัน diagram ใช้ fleet ของ v1 ที่รันอยู่เป็น baseline แต่ถ้าให้ดีที่สุด baseline ควรเป็น v1 ชุดใหม่ที่มีขนาดและเวลาเริ่มเท่ากับ canary แบบนี้ cache ที่ warm แล้วกับ uptime ยาว ๆ ของ fleet เก่าจะได้ไม่ทำให้ v1 ดูดีเกินจริง Kayenta ที่เป็น canary analysis service ของ Spinnaker ใช้ Mann-Whitney U test ตัดสินว่าความต่างนั้นเป็นของจริงหรือเปล่า เก็บ SLO check แบบค่าตายตัวไว้สักสองสามตัวเป็นราวกันตก

**Rollback อัตโนมัติ** การวิเคราะห์และกฎ rollback ถูกกำหนดไว้ก่อน release และ controller เป็นคนทำตาม ไม่ใช่คนที่นั่งดู dashboard วิธีนี้จะเร็วและปลอดภัยได้ก็ตอนที่ v1 ยังรับ traffic 100% กลับได้ เลยต้องเก็บ v1 ไว้เต็มขนาดจนกว่าจะ promote หรือ scale มันกลับขึ้นมาก่อนจะย้าย traffic กลับไป

## ใช้ตอนไหนดี

- service ที่มี traffic มากพอให้ได้สัญญาณภายในไม่กี่นาทีหรือไม่กี่ชั่วโมง
- release ที่เวอร์ชันเก่ากับใหม่รันข้างกันได้
- ความเสี่ยงที่โผล่มาแค่ตอน runtime: performance, การใช้ resource, dependency, configuration ให้ rollout การเปลี่ยน config และ feature flag แบบเดียวกันด้วย
- มันไม่ค่อยเหมาะกับ service ที่ traffic น้อย (ให้ bake นานขึ้น หรือเพิ่ม synthetic traffic) และกับงานที่ไม่ได้ขับเคลื่อนด้วย request อย่าง queue consumer กับ batch job งานพวกนั้นให้ทำ canary ตาม partition หรือใช้ v2 consumer แค่ตัวเดียว

## ได้อะไร เสียอะไร

- **มีสองเวอร์ชัน live พร้อมกัน** shared state ต้องใช้ได้กับทั้งคู่: database schema, cache, event format และ API ส่วน schema change ให้ทำแบบ backward-compatible ด้วย **expand and contract** ([parallel change](https://martinfowler.com/bliki/ParallelChange.html)): เพิ่มโครงสร้างใหม่ในรูปที่ v1 รับได้ แล้ว ship โค้ดที่ใช้มัน แล้วค่อยลบของเก่าก็ต่อเมื่อไม่มีเวอร์ชันไหนที่รันอยู่ต้องใช้แล้ว ส่วนการ rollback โค้ดก็ไม่ได้ rollback ข้อมูลที่ canary เขียนไปแล้ว
- **Release ช้าลง** ไล่ขึ้นจนครบใช้เวลาตั้งแต่หลายสิบนาทีไปจนถึงหลายชั่วโมง และ SRE Workbook แนะนำให้รัน canary ทีละตัว
- **ยังมี user บางส่วนเจอ bug** ให้ขั้นแรกเล็ก ๆ ไว้ และให้ความล้มเหลวร้ายแรง (crash loop, error 5xx พุ่ง) abort ทันทีแทนที่จะรอจนจบช่วงเวลา
- **ต้องมี telemetry แยกตามเวอร์ชัน** ทุก metric, log และ trace ต้องติดเวอร์ชันไว้ ไม่งั้นก็ไม่มีอะไรให้เทียบ

**จะเลือก canary, blue-green หรือ feature flag**

| | Canary release | Blue-green deployment | Feature flags |
|---|---|---|---|
| อะไรเปลี่ยน | build ใหม่ได้ traffic ในสัดส่วนที่ค่อย ๆ เพิ่มขึ้น | traffic ทั้งหมดย้ายไป environment ชุดที่สองในขั้นเดียว | code path ข้างใน build เดียว แยกตาม user หรือ segment |
| Rollback | ตั้งน้ำหนักของ canary เป็น 0% | สลับกลับไป environment เก่า | ปิด flag |
| Capacity ที่ต้องเพิ่ม | instance ของ canary | environment ชุดที่สองเต็ม ๆ ระหว่างสลับ | ไม่ต้องเพิ่ม |
| เก่งเรื่อง | ความเสี่ยงตอน runtime ใน build: performance, leak, dependency | ตัดเปลี่ยนเร็วและสะอาด มีทางกลับทันที | ความเสี่ยงด้าน product: dark launch, rollout ตามลูกค้า, experiment |

สามอย่างนี้ใช้ร่วมกันได้ดี: build ที่เป็น canary มักซ่อน feature ใหม่ไว้หลัง flag แบบ dark และ infrastructure แบบ blue-green ที่ย้าย traffic เป็นขั้น ๆ ก็คือ canary ส่วน rolling update ก็รันสองเวอร์ชันพร้อมกันเหมือนกัน แต่มันขยับไปทีละ instance และปกติไม่มี analysis gate คั่นระหว่าง batch

## ข้อควรรู้ตอนลงมือทำ

- **Kubernetes:** Argo Rollouts (step `setWeight`, `pause` และ `analysis` กับ `AnalysisTemplate` ที่ query Prometheus, Datadog และตัวอื่น ๆ) และ Flagger (`stepWeight`, `maxWeight`, `threshold`) รัน loop ทั้งหมดให้ พวกมันย้าย traffic ผ่าน service mesh อย่าง Istio หรือ Linkerd, ingress controller หรือ `backendRefs` แบบมีน้ำหนักบน Gateway API route
- **Managed service ยกตัวอย่างเช่น:** บน AWS มี ALB weighted target group, API Gateway canary deployment และ CodeDeploy traffic shifting สำหรับ Lambda (rollback อัตโนมัติเมื่อ CloudWatch alarm ดัง) บน Google Cloud มี Cloud Run revision traffic splitting และ Cloud Deploy canary บน Azure มี Container Apps revision splitting และ deployment-slot routing ของ App Service
- **Scale v2 ก่อนเพิ่มน้ำหนักให้มัน** (`setCanaryScale` ของ Argo Rollouts หรือ autoscaling ที่เผื่อ headroom ไว้) มันจะได้ถูกตัดสินจากโค้ด ไม่ใช่จากโหลดที่เกิน
- **ให้ tester เข้าไปก่อน** ด้วย header หรือ cookie ที่บังคับให้ไป v2 ทั้ง Flagger และ mesh ส่วนใหญ่ก็รองรับการ match ด้วย header และ cookie
