## ปัญหา

product บางตัวถูกใช้โดยคนที่ต่างกันมากเพื่อทำงานที่ต่างกันมาก คนใช้ code editor อยากได้การรองรับภาษาของตัวเอง, version control, linter และ preview คนใช้ CI server อยากได้ build tool, cloud และ notification ของตัวเอง ส่วนระบบ claim ของบริษัทประกันต้องทำตามกฎที่ต่างกันในทุกเขตอำนาจที่ให้บริการ การยัด feature ทั้งหมดนี้ไว้ใน codebase เดียวพังในแบบที่เดาได้

- **ทุก feature ปล่อยไปกับทุก release** fix ของภาษาหนึ่งต้องรอ release ถัดไปของทั้ง product และแต่ละ release ก็ทำ feature ที่ไม่มีใครแตะพังได้
- **ผู้ใช้ทุกคนจ่ายค่าทุกอย่าง** เวลา start-up และ memory โตตาม feature ที่ผู้ใช้ส่วนใหญ่ไม่เคยเปิด
- **มีแค่ vendor ที่ขยายได้** ลูกค้า partner และ community เพิ่มสิ่งที่ตัวเองต้องการไม่ได้ ถ้าไม่ fork
- **ความแตกต่างรั่วไปทั่ว** กฎที่ต่างกันตามลูกค้าหรือภูมิภาคกลายเป็น conditional กระจายอยู่ทั่วโค้ด และทุก variant ใหม่ก็ต้องแก้ไฟล์ชุดเดิม

## ทำงานยังไง

แบ่ง product เป็นสองแบบ คือ **core system** เล็ก ๆ ที่ไม่ค่อยเปลี่ยน กับ **plug-in** ที่เพิ่ม feature ผ่าน contract ที่ core กำหนด Mark Richards ที่อธิบายสไตล์นี้ไว้ใน *Software Architecture Patterns* เรียกมันอีกชื่อว่า **plug-in architecture**

**อะไรควรอยู่ใน core: ให้น้อยที่สุด**

- **Lifecycle:** หา plug-in, โหลด, activate และ shut down
- **Registry:** มี plug-in อะไรบ้าง แต่ละตัวเพิ่มอะไรเข้ามา และอยู่ใน state ไหน
- **Contract:** extension point และ API ที่ plug-in เขียนโดยอิงกับมัน
- **shared service** ที่ทุก plug-in ต้องใช้ และต้องทำงานเหมือนกันทุกที่ เช่น settings, storage, logging และถ้า product มี user interface ก็รวมหน้าต่างกับการแก้ไขพื้นฐานด้วย

feature ไปอยู่ใน plug-in รวมถึงหลายตัวที่ vendor ปล่อยเองด้วย เอกสารของ Eclipse อธิบาย runtime ของมัน (plug-in `org.eclipse.osgi` และ `org.eclipse.core.runtime`) ว่าเป็น kernel ขั้นต่ำที่ plug-in อื่นทุกตัวพึ่ง และส่วนที่เหลือของ platform รวมถึง subsystem ของมันเอง ก็สร้างเป็นชุดของ plug-in

**Extension point และ contract** extension point คือจุดที่มีชื่อ ที่ plug-in เพิ่มอะไรเข้ามาได้ โดยมี contract บอกว่าเพิ่มอะไรและเพิ่มยังไง contract มีสามรูปแบบ และระบบส่วนใหญ่ก็ผสมกัน

- *interface* ที่ plug-in implement เช่น service ของ Java `ServiceLoader`, OSGi service และ extension point ของ Jenkins
- *event หรือ hook* ที่ plug-in subscribe เช่น มีไฟล์ถูกเปิด หรือ build เสร็จแล้ว
- *declarative contribution* ใน manifest เช่น command, menu, view, ภาษา และ settings ทำให้ core แสดง command หรือรายการของ view ได้ก่อนจะรันโค้ดของ plug-in สักบรรทัด plug-in ของ Eclipse ประกาศ extension และ extension point ไว้ใน `plugin.xml` และ [คู่มือของ Eclipse](https://help.eclipse.org/latest/topic/org.eclipse.platform.doc.isv/guide/runtime_model.htm) เปรียบการกำหนด extension point ว่าเหมือนการกำหนด API แค่เขียนเป็น XML แทนที่จะเป็น signature ในโค้ด ส่วน extension ของ Visual Studio Code ก็ทำแบบเดียวกันใน section `contributes` ของ `package.json`

**การค้นหาและลงทะเบียน** core ต้องหา plug-in ที่ไม่ได้ compile มาพร้อมกับมันให้เจอ

- **[`ServiceLoader`](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/ServiceLoader.html) ของ Java** หา *provider* ของ service interface ถ้าอยู่บน class path ตัว provider จะถูกระบุไว้ในไฟล์ใต้ `META-INF/services/` ที่ตั้งชื่อตาม interface ส่วนใน module system ตัว module ของ provider ประกาศ `provides … with …` และ module ของ consumer ประกาศ `uses` ส่วนตัว provider จะถูกหาและสร้าง instance แบบ lazy และ `stream()` ทำให้ core ดู type ของ provider ได้ก่อนจะสร้าง instance
- **OSGi** package แต่ละ plug-in เป็น *bundle* คือ JAR ที่ manifest บอกชื่อและ version ของมัน และระบุ package ที่มัน import และ export พร้อมช่วง version แล้ว framework ก็ให้แต่ละ bundle มี class loader ของตัวเอง และ resolve import ของมันก่อนจะยอมให้ bundle start นอกจากนี้ bundle ยัง publish object ไว้ใน *service registry* ที่ใช้ร่วมกันภายใต้ชื่อ interface ให้ bundle อื่นมาค้นหา โดย service มาและไปได้ระหว่างที่ระบบรันอยู่ และ service ของ bundle จะถูกถอนการลงทะเบียนเมื่อ bundle นั้นหยุด
- **ระบบที่ขับด้วย manifest** อ่านไฟล์ที่มากับ plug-in เช่น `package.json` ของ VS Code, `plugin.xml` ของ Eclipse, `extension.toml` ของ Zed และ `manifest.json` ของ browser extension
- **annotation และการ scan** Jenkins หา class ที่ mark ไว้ด้วย `@Extension` สร้างมันขึ้นมา แล้วลงทะเบียนเป็น implementation ของ extension point ที่มัน extend ไม่ว่า point นั้นจะกำหนดไว้ใน Jenkins core หรือใน plugin อื่น การ scan สะดวกแต่ช้า อย่าง setting `plugin.discovery` ของ Kafka Connect ก็มีโหมด `service_load` ที่อ่าน manifest ของ `ServiceLoader` แทนการ scan ทุก plugin ด้วย reflection และ [user guide](https://kafka.apache.org/43/kafka-connect/user-guide/) ของมันก็ชี้ว่าการเลือกข้อนี้กระทบเวลา start-up ของ worker มากแค่ไหน

**Lifecycle และ lazy activation** การลงทะเบียน plug-in กับการ activate มันเป็นคนละขั้นกัน (step 1 และ 2 ของ diagram) OSGi กำหนด state ที่ bundle ผ่าน (installed, resolved, starting, active, stopping, uninstalled) และ bundle ประกาศ activation policy แบบ *lazy* ได้ ให้มันถูก activate ก็ต่อเมื่อมีการโหลด class ของมันครั้งแรก Eclipse บอกเป้าหมายไว้ตรง ๆ plug-in ที่ติดตั้งไว้แต่ไม่ได้ใช้ไม่ควรกินทั้ง memory และ performance ตัว runtime รู้ว่า plug-in มีอะไรให้โดยไม่ต้องรันมัน เพราะ extension ถูกประกาศไว้แล้ว และมันจะ activate plug-in ก็ต่อเมื่อผู้ใช้ขอสิ่งที่ plug-in มีให้ VS Code แสดงความคิดเดียวกันเป็น [activation event](https://code.visualstudio.com/api/references/activation-events) อย่าง `onLanguage:markdown`, `onCommand`, `workspaceContains` และ `onStartupFinished` ส่วนตั้งแต่เวอร์ชัน 1.74 มา แค่ contribute command, view หรือภาษา ก็พอให้ extension ถูก activate ตอนที่มีคนใช้แล้ว ไม่แนะนำให้ใช้ event `*` ที่ activate extension ตอน VS Code start เพราะ `onStartupFinished` รันช้ากว่านิดเดียวโดยไม่ทำให้ start-up ช้าลง plug-in ยังได้โอกาส clean up ตอนถูก deactivate ด้วย (VS Code เรียก function `deactivate()` ของมัน)

**Isolation: โค้ดของ plug-in รันที่ไหน** แต่ละทางเลือกแลกความปลอดภัยกับความเร็วและขอบเขตของ API

| ทางเลือก | ตัวอย่าง | ปกป้องอะไร | ต้องจ่ายอะไร |
|---|---|---|---|
| In-process | provider ของ `ServiceLoader`, OSGi bundle, Jenkins plugin, filter ที่ built-in ของ Envoy | ได้น้อย: class loader ที่แยกกันช่วยกัน library ไม่ให้ปนกัน แต่ crash, leak หรือ loop ไม่รู้จบก็กระทบทั้ง product | ไม่เสียอะไรตอน runtime: การเรียกเป็น function call ธรรมดา และ plug-in ใช้ object ร่วมกับ core ได้ |
| Separate process | extension host ของ VS Code | user interface และ core: plug-in ที่ค้างทำให้ editor ค้างไม่ได้ | ทุกการเรียกกลายเป็น message ทำให้ API ต้องเป็น asynchronous ส่วน plug-in ใน host เดียวกันก็ยังร่วมชะตาเดียวกับ host และตัวมันเองไม่ได้เป็น security boundary |
| Sandbox with permissions | browser extension | ข้อมูลและ capability: plug-in ได้แค่สิ่งที่ manifest ประกาศไว้และผู้ใช้ยอมรับ | ทุก capability ต้องออกแบบเป็น permission และการปกป้องก็ดีได้แค่เท่าที่ผู้ใช้อ่านคำเตือน |
| WebAssembly | extension ของ Zed (build เป็น WebAssembly component), Wasm filter ของ Envoy | memory และ capability: module เข้าถึงโลกภายนอกได้แค่ผ่าน function ที่ host ให้ | ข้อมูลต้องก็อปข้ามขอบเขต และ library กับ feature ของภาษาบางอย่างก็ใช้ข้างในนั้นแบบไม่แก้ไม่ได้ |

editor ใน diagram ใช้ host process แยกที่อยู่ใน sandbox ด้วย ถ้ามีแค่ process boundary อย่างเดียว จะกันได้แค่การค้างและ crash แต่ไม่ได้กัน permission [หน้า runtime security](https://code.visualstudio.com/docs/configure/extensions/extension-runtime-security) ของ VS Code บอกว่า extension รันด้วย permission เดียวกับตัว VS Code เอง มันเลยอ่านและเขียนไฟล์ ยิง network request และ start process ได้ [extension host](https://code.visualstudio.com/api/advanced-topics/extension-host) ของมันรันบน Node.js ในเครื่องหรือบนเครื่อง remote หรือรันใน web worker ใน browser และกันไม่ให้ extension ทำให้ user interface ช้าลงหรือแก้มันตรง ๆ Zed เลือกอีกทาง extension ของมัน compile เป็น WebAssembly และ [capability system](https://zed.dev/docs/extensions/capabilities) ที่ผู้ใช้จำกัดให้แคบลงได้ด้วย `granted_extension_capabilities` เป็นตัวตัดสินว่า extension ทำอะไรได้บ้าง เช่น รัน process หรือดาวน์โหลดไฟล์ ถ้าใช้ host process หนึ่งตัวต่อหนึ่ง plug-in ก็จะกัน plug-in ออกจากกันได้ด้วย แลกกับการต้องมี process ตัวละหนึ่ง

**ตอน plug-in ค้าง (step 3)** [release note ของเวอร์ชัน 1.28](https://code.visualstudio.com/updates/v1_28) ของ VS Code เพิ่ม notification สำหรับ extension host ที่ไม่ตอบสนอง พอ host หยุดตอบรับ message ของ editor ตัว VS Code ก็จะบอก และแนะนำให้รอ, profile host จาก view Running Extensions หรือ restart มันถ้าดูเหมือน extension ตัวไหนติด loop อยู่ ส่วนปัญหาที่ระบุตัวยากกว่า [extension bisect](https://code.visualstudio.com/blogs/2021/02/16/extension-bisect) จะ disable extension ที่ติดตั้งไว้ทีละครึ่ง จนเจอตัวที่เป็นต้นเหตุ

**plug-in คือโค้ดของ third-party** ให้มองมันเป็นส่วนหนึ่งของ supply chain

- **Least privilege** ให้ plug-in ประกาศสิ่งที่ต้องใช้ แล้วให้สิทธิ์อย่างชัดเจน Chrome extension ระบุ [`permissions` และ `host_permissions`](https://developer.chrome.com/docs/extensions/develop/concepts/declare-permissions) ไว้ใน manifest และขอสิทธิ์ที่เป็น optional ได้ตอน runtime แทนที่จะขอตอนติดตั้ง
- **Signing** Visual Studio Marketplace sign ทุก extension ที่มัน publish และ VS Code ก็เช็ก signature ตอนติดตั้ง ตั้งแต่เวอร์ชัน 1.97 ตัว VS Code ยังถามให้ผู้ใช้ trust publisher ที่เป็น third-party ก่อนติดตั้ง extension ของเขาด้วย
- **marketplace คอยตรวจของที่ตัวเอง host** Visual Studio Marketplace scan ทุกเวอร์ชันใหม่ด้วย malware scanner หลายตัว รัน extension ใน environment ที่แยกไว้เพื่อดูพฤติกรรม mark publisher ที่พิสูจน์แล้วว่าเป็นเจ้าของ domain กันไม่ให้ผู้เขียนเอาชื่อของ publisher ทางการและ extension ยอดนิยมไปใช้ และลบ extension ที่เป็นอันตราย แล้ว VS Code ก็จะ uninstall มันให้อัตโนมัติ
- **การ update คือการเปลี่ยนโค้ด** มันอาจพา dependency ใหม่ permission ใหม่ และพฤติกรรมใหม่มาด้วย pin version ไว้เท่าที่ทำได้ review ว่า update ขออะไรบ้าง และเก็บ allow list ไว้ในที่ที่เครื่องถูกจัดการจากส่วนกลาง

**การทำ version ให้ core API (step 4)**

- **ให้ตัวเลขมีความหมาย** ด้วย [semantic versioning](https://semver.org/spec/v2.0.0.html) ตัว major version เปลี่ยนเมื่อ API เปลี่ยนแบบเข้ากันไม่ได้ minor version เปลี่ยนเมื่อเพิ่ม feature ที่เข้ากันได้ และ patch version สำหรับ fix ที่เข้ากันได้
- **plug-in ประกาศสิ่งที่ตัวเองต้องใช้** extension ของ VS Code ต้องระบุ `engines.vscode` เช่น `^1.8.0` สำหรับ 1.8.0 ขึ้นไป มันจะได้ถูกติดตั้งเฉพาะใน editor ที่มี API ที่มันพึ่ง ส่วน OSGi bundle import package ด้วยช่วงอย่าง `[1.23,2)` และ Jenkins plugin ถูก build กับ Jenkins เวอร์ชันขั้นต่ำ และ update center จะไม่เสนอ release ของ plugin ที่ core ที่ติดตั้งอยู่ไม่ตรงกับข้อกำหนด (ปกติคือต้องใช้ Jenkins ที่ใหม่กว่า)
- **เช็กให้เร็วและปฏิเสธให้ชัด** plug-in ที่โดนปฏิเสธตอนโหลดเพราะต้องใช้ API 0.x จัดการง่ายกว่าตัวที่ไปพังด้วย method หายตอนที่มีคนคลิก command ของมันครั้งแรกเยอะ
- **deprecate ก่อนจะถอด** ให้ชื่อเก่ายังใช้ได้ผ่าน compatibility layer แล้ว mark มันว่า deprecated บอกว่าจะถอดในเวอร์ชันไหน และให้เวลาผู้เขียนย้าย Jenkins ใช้ความคิดนี้ตอนย้าย feature ออกจาก core ไปเป็น plugin คือ plugin ที่ build กับ core รุ่นเก่าจะได้ dependency โดยนัยไปที่ plugin ตัวใหม่ มันเลยยังทำงานต่อได้ ใน diagram `addCommand()` ยังใช้ได้ผ่าน layer ของ v1 จนถึง v3
- **ลองปล่อย API ใหม่ก่อนจะแช่แข็งมัน** VS Code ปล่อย API ใหม่เป็น [proposed API](https://code.visualstudio.com/api/advanced-topics/using-proposed-api) ก่อน คือใช้ได้แค่ใน build Insiders และห้ามใช้ใน extension ที่ publish แล้ว มันเลยยังเปลี่ยนได้ พอ API นิ่งแล้ว ทีมก็พยายามอย่างหนักที่จะไม่ทำให้มันพัง
- **contract ยิ่งลึกยิ่งเปราะ** [dynamic module](https://www.envoyproxy.io/docs/envoy/v1.39.0/intro/arch_overview/advanced/dynamic_modules) ของ Envoy คือ shared library ที่โหลดเข้า proxy ผ่าน ABI ที่ผูกกับ internals ของ Envoy แน่นมาก ใน Envoy 1.39 ตัว module ที่ build สำหรับ release หนึ่งรับประกันว่าใช้ได้กับ release นั้นและ release ถัดไปเท่านั้น เข้มกว่ากลไก extension แบบอื่นของ Envoy

**dependency และลำดับระหว่าง plug-in**

- **ประกาศ dependency** VS Code มี `extensionDependencies` ส่วน `extensionPack` ของมันแค่รวม extension ไว้ติดตั้งด้วยกัน ไม่ได้มีไว้สำหรับ dependency จริง ๆ OSGi มี `Import-Package` และ `Require-Bundle` และ Jenkins plugin ก็พึ่ง plugin อื่นได้
- **โหลดตามลำดับ dependency** ปฏิเสธ cycle และตัดสินใจว่าจะทำยังไงกับตัวที่พึ่งอยู่เมื่อ plug-in ถูก disable อย่างที่ Git โดนใน step 3 คือจะ disable ตัวที่พึ่งไปด้วย หรือปล่อยให้มันรันต่อโดยไม่มี feature ที่หายไปก็ได้
- **เผื่อไว้ว่าจะมี plug-in สองตัวอ้างสิทธิ์ในสิ่งเดียวกัน** OSGi เรียง service ที่แข่งกันตาม property `service.ranking` (ค่าสูงสุดก่อน แล้วตามด้วยตัวที่ลงทะเบียนก่อน) VS Code เพิ่ม setting `editor.defaultFormatter` ในเวอร์ชัน 1.33 ให้ผู้ใช้เลือกได้ว่าจะใช้ formatter ตัวไหนจากหลายตัวสำหรับภาษาเดียว ส่วนใน Envoy ลำดับของ HTTP filter ใน configuration คือลำดับที่มันเห็น request และ response ก็ผ่านมันในลำดับย้อนกลับ

**เจอได้ที่ไหน**

- **editor และ IDE** VS Code (extension host, activation event, `engines.vscode`), Eclipse (มี OSGi อยู่ข้างใต้ มี extension point และ extension registry อยู่ข้างบน) และ Zed (WebAssembly extension ที่มี capability)
- **CI server** Jenkins คือ core บวก plugin โดย extension point กำหนดไว้ทั้งใน core และใน plugin และ plugin bill of materials (BOM) ของมันก็ระบุ version ของ plugin ที่เทสต์ร่วมกันแล้ว
- **browser** ตัว extension ประกาศ permission ไว้ใน manifest และ browser ก็แสดงให้ผู้ใช้เห็นว่ามันขออะไร
- **infrastructure** Kafka Connect โหลด connector, converter และ transformation เป็น plugin จาก `plugin.path` ส่วน Envoy เพิ่มพฤติกรรมเป็น filter ที่ compile มาในตัว โหลดเป็น Wasm module หรือโหลดเป็น dynamic module
- **business rule เป็น plug-in** ใน *Software Architecture Patterns* ฉบับแรก Richards ยกตัวอย่างสไตล์นี้ด้วยการประมวลผล claim ของบริษัทประกัน core จัดการขั้นตอนที่ทุก claim ต้องผ่าน และกฎของแต่ละรัฐในสหรัฐฯ ที่ต่างกันไปในแต่ละรัฐ ไปอยู่ใน plug-in การเพิ่มรัฐหรือเปลี่ยนกฎของรัฐหนึ่งแตะแค่ plug-in เดียว ที่เทสต์และ release ได้เอง แทนที่จะอยู่ใน rule set ก้อนใหญ่ก้อนเดียวที่ทุกการเปลี่ยนต้องไปแก้

**ในระดับอื่น** ไม่ต้องเป็นทั้ง product ก็ได้ module หนึ่งใน [modular monolith](../modular-monolith/) ก็เป็น core เล็ก ๆ ที่มี plug-in ได้ (เช่นวิธีชำระเงินหรือตัว import ไฟล์ที่อยู่หลัง contract เดียวกัน) และ [microservice](../microservices/) ตัวเดียวก็เป็นได้เหมือนกัน plug-in ยังเป็น service แยกที่ implement contract ที่ publish ไว้ก็ได้ด้วย แลกกับ network call ในทุกการโต้ตอบ ส่วน [sidecar](../sidecar/) ก็ใช้ความคิดที่ใกล้กันตอน deploy มันเพิ่ม capability ไว้ข้าง ๆ service ใน process แยก โดยไม่ต้องแก้โค้ดของ service

**ไม่เหมือน adapter หรือ layer**

- [Hexagonal architecture](../hexagonal-architecture/) ก็วาง core ไว้ตรงกลางเหมือนกัน แต่ adapter ของมันเชื่อม core เข้ากับเทคโนโลยี (HTTP, database, broker) และไม่ได้เพิ่มพฤติกรรมอะไร การสลับ SQL adapter เป็น document store ไม่ได้เปลี่ยนอะไรที่ผู้ใช้เห็นเลย ส่วน plug-in เพิ่ม feature การติดตั้งมันเลยเปลี่ยนสิ่งที่ product ทำได้ ใน hexagonal architecture ตัว core กำหนด port สำหรับสิ่งที่*ตัวมันเอง*ต้องการ ส่วนใน microkernel ตัว core กำหนด extension point สำหรับสิ่งที่*คนอื่น*จะเพิ่มเข้ามา สองแบบนี้ใช้ร่วมกันได้ดี core สร้างเป็น hexagon ได้ และ plug-in ที่คุยกับระบบภายนอกก็ใช้ adapter หรือ [anti-corruption layer](../anti-corruption-layer/) ได้ เพื่อไม่ให้ model ของระบบนั้นรั่วเข้ามาใน contract
- [Layered architecture](../layered-architecture/) ซ้อนโค้ดตามหน้าที่ทางเทคนิค และ request เดินทางลงไปผ่านแต่ละ layer ส่วน microkernel แบ่งตาม feature โดยข้างใน core และ plug-in แต่ละตัวอาจแบ่ง layer ไว้ แต่รอยต่อหลักอยู่ระหว่าง core ที่คงที่กับ feature ที่แปรผัน
- [Feature flag](../feature-flags/) เปิดหรือปิดโค้ดที่อยู่ใน product อยู่แล้ว ส่วน plug-in เพิ่มโค้ดที่ core ไม่เคยเห็นมาก่อน สองอย่างนี้ใช้ด้วยกันได้ดี flag ทำให้ roll out plug-in ตัวใหม่ให้ผู้ใช้บางกลุ่มก่อนได้

**microkernel อีกความหมาย** ใน operating system คำนี้หมายถึงการออกแบบ kernel แบบหนึ่ง ที่มีแค่ core ขั้นต่ำรันใน privileged mode ของ processor ส่วน service อย่าง device driver และ file system รันเป็น process แยกอยู่ข้างบน และคุยกันผ่าน kernel [โปรเจกต์ Mach](https://www.cs.cmu.edu/afs/cs/project/mach/public/www/overview.html) ของ Carnegie Mellon (1985–1994) สร้าง kernel แบบนี้ขึ้นมา ตระกูล L4 ตามมาช่วงกลางทศวรรษ 1990 และหนึ่งในสมาชิกของมันคือ [seL4](https://sel4.systems/About/seL4-whitepaper.pdf) มาพร้อม proof ที่เครื่องตรวจแล้วว่า implementation ของมันถูกต้อง Richards บอกว่าสไตล์ระดับแอปพลิเคชันมีรากมาจากตรงนั้น หน้านี้พูดถึงสไตล์ระดับแอปพลิเคชัน ในสไตล์นี้ plug-in คือ feature ของ product ไม่ใช่ driver

## ใช้ตอนไหนดี

- **product ที่คนจำนวนมากขยายในแบบที่ต่างกัน:** editor และ IDE, browser, CI server, integration platform และ proxy
- **ความแตกต่างตามลูกค้า ตลาด หรือเขตอำนาจ:** กฎ claim หรือภาษีตามภูมิภาค ตัว import ตามรูปแบบไฟล์ วิธีชำระเงินตามประเทศ ที่แต่ละ variant build และเทสต์ได้เอง
- **third-party ควรเพิ่ม feature ได้โดยไม่ต้องรอ release ของเรา** หรือเราอยากให้มี ecosystem รอบ product
- **feature หนักที่เป็น optional** ที่ผู้ใช้ส่วนใหญ่ไม่เคยเปิด lazy activation ทำให้มันไม่กินอะไรเลยจนกว่าจะมีคนใช้

**ตอนไหนไม่ควรใช้:**

- **ไม่มีอะไรแปรผัน** ถ้าลูกค้าทุกคนใช้ feature ชุดเดียวกัน extension point ก็เป็นแค่พิธีกรรม ส่วน [modular monolith](../modular-monolith/) ที่วางโครงไว้ดีจะง่ายกว่า
- **plug-in ต้องเข้าถึง internals ของ core ลึก ๆ** แบบนั้น contract ก็คือ core ทั้งก้อน การเปลี่ยน internal ทุกครั้งทำ plug-in พัง และ isolation แบบ step 3 ก็ทำไม่ได้
- **ตัว core เองยังเปลี่ยนอยู่เรื่อย ๆ** contract ต้องการ core ที่นิ่ง ระหว่างที่การออกแบบของ core ยังขยับอยู่ extension point จะแช่แข็งสิ่งที่ผิด ให้เก็บ feature ไว้ใน core ไปก่อนจนกว่ารอยต่อจะชัด
- **"plug-in" จริง ๆ แล้วเป็นแอปพลิเคชันแยก** ที่มีข้อมูล ทีม และ release cycle ของตัวเอง แบบนั้น [service](../microservices/) แยกอาจเหมาะกว่า

## ได้อะไร เสียอะไร

- **contract กลายเป็น product** พอคนอื่นสร้างของบน extension point แล้ว ทุกการเปลี่ยนต้องมี version แผนเรื่องความเข้ากันได้ และช่วงเวลา deprecation (step 4)
- **compatibility layer กองพะเนิน** แต่ละตัวคือโค้ดที่ต้องเทสต์และดูแล และ core ต้องแบกมันไว้จนถึงวันถอดที่สัญญาไว้
- **isolation มีราคา** plug-in แบบ in-process เร็วแต่ทำ product ล่มได้ plug-in แบบ out-of-process ปกป้อง core แต่ทุกการเรียกเป็น message ทำให้ API กลายเป็น asynchronous และการ debug ต้องข้าม process boundary
- **เวลา start-up และ memory** การค้นหาด้วยการ scan, eager activation และ plug-in ที่ active อยู่จำนวนมาก ทำให้ start-up ช้าลง วัดเวลา activation ของแต่ละ plug-in ไว้
- **plug-in มีปฏิสัมพันธ์กัน** dependency, ลำดับ, การแย่ง extension point เดียวกัน และ host process ที่ใช้ร่วมกัน ทำให้เกิดปัญหาที่เทสต์ของ plug-in ตัวเดียวไม่มีทางเห็น
- **เทสต์ทุก combination ไม่ได้** สิ่งที่ผู้ใช้รันคือ core บวกชุด plug-in ของเขาเองในเวอร์ชันของเขาเอง
- **Security** ทุก plug-in คือโค้ดที่คนอื่นเขียน และรันด้วยสิทธิ์เท่าที่ core ให้มัน
- **Support** ผู้ใช้รายงาน bug ที่ product การหาว่า plug-in ตัวไหนเป็นต้นเหตุต้องใช้เครื่องมืออย่าง bisect และ profiling แยกต่อ plug-in

## ข้อควรรู้ตอนลงมือทำ

- **publish contract แยกออกมา** วาง extension point และ API ไว้ใน package แยก (SDK หรือ API module) ที่มี version ของตัวเอง และอย่าให้ internals ของ core เข้าไปอยู่ในนั้น plug-in compile กับ package นั้นเท่านั้น
- **ทำ manifest ให้เป็น declarative และครบ:** identity, version, contribution, activation event, ช่วงของ API, dependency และ permission ส่วน core ควรลงทะเบียน plug-in สร้าง menu ของมัน และเช็กความเข้ากันได้ได้โดยไม่ต้องโหลดโค้ดของมัน
- **activate แบบ lazy เป็นค่าตั้งต้น** และให้ eager activation เป็นสิ่งที่ plug-in ต้องให้เหตุผล
- **เรียก plug-in แบบระวังตัว:** ไม่เรียกบน user-interface thread เด็ดขาด ใส่ timeout และวางไว้หลัง error boundary ที่ disable plug-in หลังพังซ้ำ ๆ แล้วบอกผู้ใช้ว่าเป็นตัวไหน
- **เช็กช่วง version ตอนติดตั้งและเช็กอีกรอบตอนโหลด** พร้อมข้อความที่บอกชื่อ plug-in ช่วงของ API ที่มันต้องการ และช่วงที่ core มีให้
- **deprecate อย่างเปิดเผย:** mark API เก่าไว้ เตือนเมื่อ plug-in ยังใช้มันอยู่ บอกเวอร์ชันที่จะถอด และทำตามสัญญานั้น
- **เทสต์สามระดับ:**
  - *contract:* ชุดเทสต์ที่ implementation ทุกตัวของ extension point ต้องผ่าน และรันกับ plug-in ที่ built-in มากับ core ด้วย
  - *แต่ละ plug-in กับ core เวอร์ชันที่มันอ้างว่ารองรับ:* `@vscode/test-cli` และ `@vscode/test-electron` ของ VS Code รัน [integration test](https://code.visualstudio.com/api/working-with-extensions/testing-extension) ของ extension ข้างใน VS Code instance ตัวจริง คือ Extension Development Host ที่เข้าถึง API ได้เต็มที่
  - *combination ที่คนใช้จริง:* ผู้เขียน Jenkins plugin build กับ [plugin bill of materials](https://www.jenkins.io/doc/developer/plugin-development/dependency-management/) ได้ ตัวนี้คือชุด version ของ plugin ที่เทสต์ร่วมกันแล้ว
- **observe แยกต่อ plug-in:** เวลา activation, error, CPU และ memory เพื่อให้เวลา start-up ช้าหรือ host ค้าง ชี้ไปที่ plug-in ตัวไหนสักตัว แทนที่จะชี้ไปที่ทั้ง product
