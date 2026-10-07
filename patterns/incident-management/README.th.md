## ปัญหา

ตอน production พัง วิศวกรเก่ง ๆ ก็ทำสิ่งที่เขาถูกจ้างมาทำ: กระโดดลงไปแก้ปัญหาทางเทคนิค แต่ถ้าไม่มีวิธีรับมือที่ตกลงกันไว้ แรงพวกนั้นก็กระจัดกระจาย ขั้นที่ 1 ลองนึกภาพคืนวันเสาร์ของ Acme Shop แบบนั้น ตัว checkout `1.43.0` roll out ตอน 20:05 แล้ว payment provider ก็ช้าลงราว 20:09 และ request ของ checkout ก็เริ่ม fail คนเก้าคนแห่กันเข้า channel `#checkout` ที่ใช้ร่วมกันแล้ว debug พร้อมกัน สองคนในนั้น restart pod ของ checkout ในนาทีเดียวกันจน error พุ่ง ทีม support ไม่มีคำตอบให้ลูกค้า ตัว status page ยังบอกว่าทุกอย่างปกติ ส่วน manager ก็ถามหาความคืบหน้าทุกไม่กี่นาที และไม่มีใครรู้ว่าใครมีสิทธิ์ตัดสินใจ rollback

แต่ละคนทำสิ่งที่สมเหตุสมผลในมุมของตัวเอง แต่ไม่มีใครเห็นภาพรวมทั้งหมด บทที่ 14 ของ *Site Reliability Engineering* ของ Google (2016) คือ "Managing Incidents" ที่ Andrew Stribblehill เขียน เล่าเรื่องแบบนี้ไว้ และตั้งชื่ออันตรายสามอย่างที่ทำให้มันบานปลาย:

- **จดจ่ออยู่กับปัญหาทางเทคนิคมากเกินไป** วิศวกร on-call ยุ่งกับการแก้ของจนไม่มีใครถอยออกมาคิดเรื่อง mitigation, ผลกระทบ หรือว่าใครอื่นควรมาช่วย
- **การสื่อสารที่แย่** ไม่มีใครรู้ว่าเพื่อนร่วมงานทำอะไรอยู่ และหัวหน้ากับลูกค้าก็ได้แต่เดา
- **Freelancing** (ต่างคนต่างทำ) คนที่หวังดีแก้ production โดยไม่ประสานกัน และในเรื่องของหนังสือ การแก้แบบนี้ครั้งหนึ่งทำให้ outage แย่ลงมาก

ราคาที่ต้องจ่ายคือ outage ที่นานขึ้น ความเสียหายจากการเปลี่ยนแปลงที่ทับกัน ลูกค้าที่รู้เรื่องจาก payment ที่ fail แทนที่จะรู้จากเรา และคนรับมือที่หมดแรงก่อนจะเข้าใจปัญหา

## ทำงานยังไง

Incident management คือโครงสร้างการรับมือที่ทีมตกลงกัน เขียนไว้ และซ้อมไว้ก่อนอะไรจะพัง พอเกิด incident คนก็แค่ก้าวเข้าไปรับบทบาท ไม่ต้องคิด process ขึ้นมาใหม่ท่ามกลางความกดดัน

**มาจากไหน** Google สร้าง incident management ของตัวเองบนพื้นฐานของ Incident Command System (ICS) ของสหรัฐฯ ตามที่ทั้งหนังสือ SRE (บทที่ 14) และ *The Site Reliability Workbook* (2018, บทที่ 9, "Incident Response" โดย Jennifer Mace, Jelena Oertel, Stephen Thorne และ Arup Chakrabarti จาก PagerDuty ร่วมกับ Jian Ma และ Jessie Yang) อธิบายไว้ เอกสาร training ของ FEMA สืบย้อน ICS กลับไปถึง FIRESCOPE (Firefighting Resources of California Organized for Potential Emergencies) ความร่วมมือในยุค 1970 ระหว่างหน่วยงานระดับท้องถิ่น ระดับรัฐ และรัฐบาลกลางใน California ส่วนตอนนี้ ICS ก็เป็นส่วนหนึ่งของ National Incident Management System (NIMS) ของสหรัฐฯ และใช้กับเหตุฉุกเฉินทุกแบบ ทีม software ยืมแนวคิดหลักของมันมา: commander คนเดียว บทบาทที่ขยายและหดตาม incident และการส่งต่อการบัญชาการแบบชัดเจน

**องค์ประกอบ** หนังสือ SRE ระบุลักษณะสี่ข้อของการรับมือที่ทำได้ดี:

- **แยกความรับผิดชอบ แบบซ้อนลงไปได้เรื่อย ๆ** คนละคนรับการบัญชาการ incident, งาน operation, การสื่อสาร และการวางแผน และใครก็ตามที่งานเริ่มล้นมือก็แบ่งงานบางส่วนต่อให้คนอื่นอีกทอด บทบาทที่ชัดเจนทำให้คนมีอิสระมากขึ้น ไม่ใช่น้อยลง เพราะไม่มีใครต้องคอยเดาว่าเพื่อนร่วมงานทำอะไรอยู่
- **command post ที่ทุกคนรู้จัก** ทุกคนที่เกี่ยวข้องทำงานในที่เดียวที่รู้กัน จะเป็น war room หรือ chat channel ก็ได้ ที่ Acme คือ `#inc-checkout-1003`
- **incident state document ที่ update สด ๆ** งานที่สำคัญที่สุดของ commander คือ document ที่ใช้ร่วมกัน มีสถานะปัจจุบันอยู่ด้านบน และเก็บไว้ใช้ทำ postmortem ทีหลัง หนังสือบอกว่ามีทีมหนึ่งใน Google เก็บมันไว้บน product คนละตัวกับตัวที่ทีมอาจต้องแก้ เพราะการพึ่งระบบที่พังอยู่เพื่อจัดการ outage ของตัวมันเองจบไม่สวย
- **การส่งต่อที่ชัดเจนและทำกันสด ๆ** การบัญชาการถูกส่งต่ออย่างชัดเจน โดย commander คนใหม่ได้รับ brief และยืนยันรับ ไม่ใช่ค่อย ๆ หายไปเฉย ๆ

ตัว workbook สรุปจุดประสงค์ไว้เป็น **three Cs**: ประสาน (coordinate) การรับมือ, สื่อสาร (communicate) ระหว่างคนที่รับมือ ข้ามทั้งองค์กร และกับโลกภายนอก และคุม (control) ว่าอะไรกำลังถูกเปลี่ยน

**บทบาท** ชื่อเรียกต่างกันไปในแต่ละแหล่ง แต่งานเหมือนกัน ตัว commander ถือทุกบทบาทที่ยังไม่ได้แจกให้ใคร ทำให้ใน incident เล็ก ๆ อาจมีคนเดียวทำทุกอย่าง

| บทบาทที่ Acme | งานระหว่าง incident | หนังสือ Google SRE | PagerDuty | Atlassian |
|---|---|---|---|---|
| **Incident commander:** Mai | ถือภาพรวม แจกบทบาท ตัดสินใจ และ update incident document ให้เป็นปัจจุบัน ไม่ลง debug เอง | Incident Commander (IC) | Incident Commander | Incident manager |
| **Operations lead:** Tom | คุมงานทางเทคนิค มีแค่ทีม operations ที่แก้ production | Operations Lead (OL) | (การแก้มาจาก subject matter expert) | Tech lead |
| **Communications lead:** Ploy | status page, ทีม support และ manager ตามจังหวะที่กำหนด | Communications Lead (CL) | Customer liaison, internal liaison | Communications manager |
| **Scribe** | จด timeline, การตัดสินใจ และงานที่ต้องตามต่อ ลงใน incident document | (commander เป็นเจ้าของ document) | Scribe | (incident manager คนที่สองช่วยจด timeline ได้) |
| **ผู้เชี่ยวชาญ ตามที่ต้องการ** | เข้ามาเมื่อ commander ขอ และทำงานภายใต้ operations lead | (เข้าร่วมงาน operation) | Subject matter experts | (tech lead เพิ่มสำหรับงานที่ทำขนานกันหลายสาย) |

หนังสือ SRE ยังมีบทบาทวางแผน (planning) สำหรับงานระยะยาวกว่า: เปิด bug, จัดการส่งต่อให้กะถัดไป และติดตามว่าเปลี่ยนอะไรไปบ้าง จะได้เปลี่ยนกลับได้ทีหลัง ส่วน PagerDuty ก็มี deputy ที่คอยหนุน commander และ training สำหรับ commander ของ PagerDuty ก็บอกตรง ๆ ว่า commander ส่งต่องานซ่อมทุกอย่างให้คนอื่น และไม่ดูกราฟหรืออ่าน log เอง

**วงจรของ incident ในคืนนั้นของ Acme**

1. **ตรวจพบ** error เริ่มราว 20:09 แล้ว alert ตาม burn rate ของ SLO (error 12% เทียบกับเป้า 99.9% คือ burn rate 120× ดู [SLOs & Error Budgets](../slo-error-budgets/)) ก็ page หา Mai วิศวกร on-call ของ checkout ตอน 20:14 ส่วนทำไมถึงใช้เวลาห้านาทีเป็นคำถามสำหรับ postmortem
2. **รับมือ** Mai กด acknowledge ตอน 20:17 ประกาศ SEV-2 เปิด `#inc-checkout-1003` และ incident document แล้วรับเป็น commander ส่วน Tom เป็น operations lead, Ploy (หัวหน้าทีม support) เป็น communications lead และ scribe เริ่มจด timeline
3. **Mitigate** Mai ถามว่าอะไรเปลี่ยนไป แล้ว Tom ก็ rollback กลับไป `1.42.0` ตอน 20:24 และเพราะ payment provider ยังช้าอยู่ Tom เลยเปิด flag `payments.fallback` ที่มีอยู่แล้วตอน 20:31 ด้วย โดย flag นี้ส่ง payment ไปที่ provider ตัวที่สอง ตอน 20:36 error กลับมาที่ 0.3%: หลังจาก page ไป 22 นาที ลูกค้าก็จ่ายเงินได้อีกครั้ง ส่วน root cause รอไปก่อน ตัว workbook อธิบายลำดับของ Google ว่าหยุดผลกระทบก่อน แล้วค่อยหาสาเหตุ และ case study ในเล่มก็แสดงว่า mitigation แบบทั่วไปอย่าง rollback แค่ต้องรู้ว่าปัญหาอยู่ *ที่ไหน* ไม่ต้องรู้ว่า *ทำไม*
4. **Resolve** ฝั่ง provider กลับมาปกติตอน 21:10 แล้วตอน 21:30 Mai ก็ resolve incident ประกาศยุติการรับมือ และทิ้ง handoff note ไว้: checkout ยังอยู่ที่ `1.42.0` และงานที่ต้องตามต่อเป็นของ postmortem ส่วน checkout ที่ fail มีราว 1,240 ครั้ง และลูกค้าลองใหม่ได้
5. **เรียนรู้** มีการนัด blameless postmortem โดยใช้ timeline ของ scribe เป็นแกนหลัก ส่วนนั้นมีหน้าของมันเอง: [Blameless Postmortems](../blameless-postmortems/)

**ระดับ severity** ตาราง severity ตัดสินว่าใครจะโดน page และ process แค่ไหนจะเริ่มทำงาน แล้วยังช่วยไม่ให้ต้องเถียงกันระหว่าง incident แต่ละแหล่งใช้จำนวนระดับไม่เท่ากัน: เอกสารสาธารณะของ PagerDuty ใช้ SEV-1 ถึง SEV-5 และนับ SEV-1 กับ SEV-2 เป็น major incident ส่วน handbook ของ Atlassian ใช้สามระดับ และ page คนสำหรับสองระดับบนสุด ส่วน scale ของ Acme ข้างล่างนี้เป็นแค่ตัวอย่าง:

| ระดับ | นิยามของ Acme (ตัวอย่างประกอบ) | การรับมือ |
|---|---|---|
| SEV-1 | checkout หรือทั้งร้านล่มสำหรับลูกค้าส่วนใหญ่ ข้อมูลหาย หรือมี security breach | page commander และทุกทีมเจ้าของทันที ขึ้น status page แจ้งผู้บริหาร |
| SEV-2 | journey หลัก (checkout, payment, search) fail สำหรับลูกค้าจำนวนมาก | page on-call ของทีมเจ้าของ ประกาศ incident จัดคนลงบทบาท ขึ้น status page |
| SEV-3 | feature รองพังหรือช้า หรือมีทางเลี่ยงอยู่ | ทีมเจ้าของแก้ในเวลาทำงาน ไม่ขึ้น status page ยกเว้น support ขอ |
| SEV-4 | ยังไม่กระทบลูกค้า: redundancy หายไป หรือมีความเสี่ยงที่อาจโตขึ้น | เปิด ticket ให้ทีมเจ้าของ |

**การสื่อสาร** handbook ของ Atlassian ให้ template สำหรับ update ภายใน: หนึ่งหรือสองประโยคเรื่องสถานะปัจจุบันและผลกระทบ ส่วน *current status* สั้น ๆ ส่วน *next steps* สั้น ๆ และบอกว่า update ถัดไปจะมาเมื่อไรและที่ไหน มันยังขอให้ commander บอกตรง ๆ ว่ายังไม่รู้อะไรบ้าง ส่วน Acme ส่ง update ทุก 30 นาที เป็นจังหวะที่เลือกเอง (เอกสารของ PagerDuty แนะนำราว 30 นาทีสำหรับสรุปให้ผู้บริหาร): status page ขึ้นว่า *Investigating* ตอน 20:20, *Monitoring* ตอน 20:50 และ 21:20 และ *Resolved* ตอน 21:30 ทีม support มีคำตอบสำเร็จรูปสำหรับ known issue ตั้งแต่ 20:20 และ manager ได้ update ชุดเดียวกันในจังหวะเดียวกัน เลยไม่มีใครต้องไปไล่ถามคนที่กำลังรับมือ

## ลงมือทำจริงยังไง

1. **เขียนไว้ว่าเมื่อไรต้องประกาศ incident** ใช้เกณฑ์ที่วิศวกรที่เหนื่อยอยู่ใช้ได้ในไม่กี่วินาที หนังสือ SRE ยกเกณฑ์ของทีมหนึ่งไว้: ต้องใช้ทีมที่สอง ลูกค้ามองเห็นปัญหา หรือยังแก้ไม่ได้หลังทุ่มทำมาหนึ่งชั่วโมง การประกาศมีต้นทุนต่ำเมื่อการปิดมีต้นทุนต่ำ คำแนะนำในหนังสือ Google ทั้งสองเล่มเลยคือให้ประกาศเร็ว ๆ
2. **ตกลง scale ของ severity** พร้อมสิ่งที่แต่ละระดับ trigger และกฎสำหรับตอนไม่แน่ใจที่ PagerDuty ใช้: ถ้าไม่แน่ใจระหว่างสองระดับ ให้เลือกระดับที่สูงกว่า แล้วทบทวนใน postmortem
3. **เตรียม command post** แบบแผนการตั้งชื่อ channel ของ incident (ของ Acme หน้าตาแบบ `#inc-checkout-1003`), template ของ incident document ที่มีสถานะอยู่ด้านบน และรายชื่อว่าต้อง page ใครสำหรับแต่ละ service ตัว workbook เพิ่มว่า: เลือก channel ไว้ก่อนจะต้องใช้ และเตรียม template ประกาศสำเร็จรูปไว้สองสามแบบ
4. **ทำบทบาทให้เป็นของจริง** คนที่ประกาศ incident มักรับเป็น commander จนกว่าจะส่งต่อ ส่วนองค์กรที่ใหญ่กว่ามีเวร commander แยก ฝึก commander และหมุนบทบาทกัน ทุกคนจะได้รู้จักทุกบทบาท
5. **เตรียม mitigation แบบทั่วไปไว้ให้พร้อม** rollback ในขั้นตอนเดียว, feature flag ที่ปิด dependency หรือเปลี่ยนเส้นทางไปเลี่ยงมัน, การ drain zone, การ failover database ใส่พวกนี้ไว้ใน runbook: ที่ Acme flag `payments.fallback` มีอยู่แล้ว แต่ไม่อยู่ใน runbook และนี่เป็นหนึ่งใน contributing factor ที่ postmortem เจอ
6. **สื่อสารเป็นจังหวะ** แยกกลุ่มผู้รับเป็นลูกค้า (status page) ทีม support (คำตอบสำเร็จรูปสำหรับ known issue) และ stakeholder ภายใน (channel หรือ mailing list เดียว) และบอกทุกครั้งว่า update ถัดไปจะมาเมื่อไร
7. **ปิดอย่างตั้งใจ** resolve incident บอกทุกคนว่าการรับมือจบแล้ว เขียน handoff note (ตอนนี้อะไรรันอยู่ อะไรยังค้าง ใครเป็นเจ้าของงานที่ต้องตามต่อ) และนัด postmortem
8. **ซ้อม** ทีม SRE ของ Google จัด *Wheel of Misfortune* ที่ game master เล่น outage ในอดีตหรือที่แต่งขึ้น แล้ววิศวกร on-call ก็รับมือ (หนังสือ SRE บทที่ 28) ตัว workbook แนะนำ drill ที่สร้างจาก postmortem ในอดีต และให้รัน incident เล็ก ๆ ด้วย process เต็มรูปแบบ ส่วน PagerDuty ฝึกคนรับมือใน Failure Friday และ Atlassian ให้ commander ที่อยู่ระหว่างฝึกร่างข้อความสื่อสารของ incident สมมติแล้วอ่านออกเสียง ส่วน game day จาก [Chaos Engineering](../chaos-engineering/) ก็ซ้อมการรับมือไปพร้อมกับตัวระบบ
9. **tool เหล่านี้เป็นแค่ตัวอย่าง ไม่ใช่ข้อบังคับ** การ page และตาราง on-call (PagerDuty หรือ Jira Service Management ที่ Atlassian กำลังย้าย Opsgenie เข้าไป ก่อนจะปิด Opsgenie ในวันที่ 5 เมษายน 2027), chat (Slack, Microsoft Teams), status page (Atlassian Statuspage) และ incident bot ที่เปิด channel สร้าง document จาก template และโพสต์ alert กับรายการใน timeline ส่วน document และช่องทางสื่อสารก็ให้แยกเป็นอิสระจากระบบที่อาจล่มอยู่
10. **วัดผลอย่างระวัง** *Incident Metrics in SRE* ของ Google (Štěpán Davidovič, 2021) แสดงว่าระยะเวลาของ incident เบ้ไปทางขวา (positively skewed): ส่วนใหญ่สั้น และมีไม่กี่ตัวที่ยาวมาก ค่าเฉลี่ย (MTTR และตัวที่คล้ายกัน) เลยขยับเยอะ แม้ไม่มีอะไรเกี่ยวกับ incident เปลี่ยนไปเลย มันสรุปว่าค่าเฉลี่ยพวกนี้บอกเรื่อง reliability ได้น้อย และบอกไม่ได้ว่าการเปลี่ยน process ได้ผลหรือเปล่า ให้วัด reliability ด้วย SLO และถ้าจะตัดสินการเปลี่ยนแปลงในการรับมือ ให้ดูขั้นตอนที่ถูกเปลี่ยนใน incident ตัวอย่างจำนวนหนึ่งที่ศึกษาอย่างละเอียด ส่วน The VOID ฐานข้อมูลของ community ที่รวม incident report สาธารณะ ก็ใช้ report เหล่านั้นตั้งคำถามกับการใช้ระยะเวลา, severity และ MTTR เป็นตัววัด

## อยู่ตรงไหนใน solution

- **[SLOs & Error Budgets](../slo-error-budgets/)** สร้าง alert ที่เริ่มการรับมือ: page ตาม burn rate แปลว่า user กำลังได้รับผลกระทบอยู่ตอนนี้ ส่วน error budget ก็เป็นตัววัด reliability ในระยะยาวที่ดีกว่าค่าเฉลี่ยของระยะเวลา incident
- **[Golden Signals, RED & USE](../golden-signals/)** ตัดสินว่าอะไรคุ้มที่จะ page และให้ commander กับ operations lead เห็น latency, traffic, error และ saturation ได้อย่างรวดเร็ว ระหว่างที่หาว่าอะไรเปลี่ยนไป
- **[You Build It, You Run It](../you-build-it-you-run-it/)** คือเหตุผลที่คนแรกที่ถูก page คือ Mai วิศวกร checkout ที่ลงมือกับ checkout service ได้ ส่วน incident management คือวิธีที่ทีมเจ้าของหนึ่งทีมดึงทีมอื่นเข้ามา เมื่อปัญหาข้ามเส้นแบ่งระหว่างทีม
- **[Canary Release](../canary-release/)** และ **[Feature Flags](../feature-flags/)** คือเครื่องมือ mitigate ในขั้นที่ 3: rollback ที่รวดเร็ว และ flag ที่เปลี่ยนเส้นทางไปเลี่ยง dependency ส่วน canary ของ Acme ปล่อย `1.43.0` ผ่าน เพราะ analysis ของมันเทียบแค่ error rate และ p95 latency ของเส้นทางหลัก ไม่ได้ดู latency ของ payment
- **[Timeout & Fallback](../timeout-and-fallback/)** และ **[Circuit Breaker](../circuit-breaker/)** คือด้านการออกแบบของเรื่องเดียวกัน: payment client ที่ upgrade แล้วรอได้นานถึง 30 s โดย default ทำให้ thread ของ request กองพะเนิน แทนที่จะ fail เร็วแล้ว fallback
- **[Chaos Engineering](../chaos-engineering/)** ให้การรับมือได้ซ้อมจริง และ **[Blameless Postmortems](../blameless-postmortems/)** เปลี่ยน timeline ของ scribe ให้เป็นบทเรียนและ action item ที่มีเจ้าของ หลัง incident จบ

## ใช้ตอนไหนดี

**คุ้มตรงไหน** service ไหนก็ตามที่ลูกค้าหรือทีมอื่นพึ่งพา และปัญหาไหนก็ตามที่ต้องใช้มากกว่าหนึ่งคน ข้ามเส้นแบ่งระหว่างทีม ลูกค้ามองเห็น หรือกินเวลานานกว่าการแก้แบบเร็ว ๆ ยิ่งมีคนเกี่ยวข้องมาก บทบาทก็ยิ่งสำคัญ: ใน case study ของ workbook เรื่อง outage ของ Google [Kubernetes](../kubernetes/) Engine มีคน 41 คนเข้ามาใน chat channel ตลอดช่วงเวลาของ incident

**ปรับขนาดให้เข้ากับทีม** ทีมห้าคนไม่ต้องมีห้าบทบาท ตัว commander ถือทุกบทบาทที่ยังไม่ได้แจก ทำให้ incident เล็ก ๆ อาจมีคนหนึ่งเป็น commander และทำงาน operation ไปด้วย โดยมีอีกคนเขียน update ส่วนสิ่งที่ไม่หดตามคือนิสัย: ประกาศ incident, channel เดียว, document เดียว, commander ที่มีชื่อชัดเจน, update สม่ำเสมอ และปิดให้เรียบร้อย องค์กรใหญ่ไปอีกทาง คือมีเวร commander โดยเฉพาะ แยกการสื่อสารภายในกับภายนอก และมี sub-incident ที่มี lead ของตัวเอง

**ตรงไหนที่ต้นทุนมากกว่าที่ได้คืน** การประกาศ page ประจำวันทุกครั้งเป็น incident สร้าง noise และความล้า เกณฑ์การประกาศเลยควรอยู่ที่ผลกระทบและการประสานงาน และควร resolve ให้เร็วเมื่อการแก้ง่าย ตัว process นี้ใช้เวลาซ้อมและกำลังคนของ on-call ที่ทีมต้องวางแผนไว้ ส่วน incident บางแบบต้องการมากกว่าที่หน้านี้อธิบาย: security incident และ data breach มักรันในอีกเส้นทางที่มีขั้นตอนด้านกฎหมาย privacy และ forensic และธุรกิจที่มี regulation อาจต้องแจ้งหน่วยงานรัฐ ถ้าระบบเก่าดูแลโดยกลุ่ม operations แยกต่างหาก ให้ตกลงไว้ก่อนว่าใครเป็น commander และการส่งต่อระหว่างทีมทำยังไง

## กับดักที่เจอบ่อย

- **ฮีโร่ที่แก้คนเดียว** วิศวกรคนหนึ่งเงียบ ๆ แก้ปัญหาไปหนึ่งชั่วโมง โดยที่ไม่มีใครรู้ว่ามีปัญหาอยู่ *ควรทำแทน:* ประกาศเร็ว ๆ และดึงคนเข้ามา handbook ของ Atlassian บอกคนรับมือว่าอย่าลังเลที่จะ escalate และเรื่องในหนังสือ SRE เองก็แสดงให้เห็นว่าการรอมีราคาแค่ไหน
- **commander ที่ลง debug เอง** พอ commander เริ่มอ่าน log ก็ไม่มีใครประสานงาน สื่อสาร หรือคอยดูเวลา *ควรทำแทน:* commander มอบงานแก้ให้คนอื่น ถ้าต้องลงมือเอง ก็ส่งการบัญชาการให้คนอื่นก่อน ตามที่ workbook อธิบาย
- **เถียงเรื่อง severity แทนที่จะประกาศ** สิบนาทีที่ใช้ตัดสินระหว่าง SEV-2 กับ SEV-3 คือสิบนาทีของ incident ที่ไม่มีใครจัดการ *ควรทำแทน:* ถ้าไม่แน่ใจให้ประกาศระดับที่สูงกว่า ลดระดับทีหลัง และทบทวนการเลือกใน postmortem
- **ใช้ mean time to recover เป็นเป้า** เพราะระยะเวลาของ incident เบ้ ค่าเฉลี่ยเลยแกว่งไปตาม incident ยาว ๆ ตัวเดียว และการตั้งเป้าก็อาจล่อให้คนปิด incident เร็วเกินไปหรือแตกมันออกเป็นหลายตัว *ควรทำแทน:* ติดตาม SLO และ error budget และเรียนรู้จาก timeline ของแต่ละ incident
- **หา root cause ก่อน mitigate** การตามหาสาเหตุที่แท้จริงในขณะที่ลูกค้ายังทำรายการไม่สำเร็จอยู่ ทำให้ outage นานขึ้น *ควรทำแทน:* หยุดผลกระทบด้วย rollback, flag หรือ failover ก่อน แล้วค่อยหาสาเหตุเมื่อลูกค้าปลอดภัยแล้ว
- **การเปลี่ยนแปลงจากนอกทีม operations** สองคน restart pod เดียวกัน อย่างในขั้นที่ 1 คือ freelancing ตามที่หนังสือ SRE เรียก *ควรทำแทน:* มีแค่ทีมของ operations lead ที่แก้ production และทุกการเปลี่ยนแปลงต้องประกาศใน channel
- **เงียบ หรือลืมปิด** ถ้าไม่มี update คนจะคิดว่าไม่มีใครทำอะไร ถ้าไม่ปิดให้ชัด คนจะคิดว่ายังไม่จบ *ควรทำแทน:* ส่ง update เป็นจังหวะที่กำหนด พร้อมบอกเวลาของ update ถัดไป และประกาศว่าการรับมือจบแล้ว
- **process ที่มีอยู่แค่บนกระดาษ** ทักษะจะจางหายถ้าไม่ได้ใช้ *ควรทำแทน:* ซ้อมด้วย role-play, drill และ game day และหมุนบทบาทกัน
