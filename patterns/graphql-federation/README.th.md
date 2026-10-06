## ปัญหา

หน้าสินค้าในระบบ [microservices](../microservices/) ต้องใช้ข้อมูลที่สามทีมเป็นเจ้าของ: Products มีชื่อและราคา Reviews มี rating ส่วน Inventory รู้ว่าอะไรมีของอยู่ client อยากได้ทั้งหมดใน request เดียว และอยากได้ในรูปร่างที่หน้าจอต้องใช้

GraphQL ให้ client ได้แบบนั้นเป๊ะ: endpoint เดียว กับ query ที่ระบุ field ที่ต้องการ ส่วนที่ยากคือใครจะเป็นคนสร้างและรัน server

- **GraphQL server ตัวเดียวทั้งบริษัท** type และ resolver ของทุกทีมอยู่ใน codebase เดียว และ ship ใน deploy เดียว ทีมที่เป็นเจ้าของ server เลยกลายเป็นคิว แล้วการเปลี่ยนที่พังแค่ครั้งเดียวก็ block release ของทุกคน
- **GraphQL API หนึ่งตัวต่อทีม** แต่ละทีม ship ได้เอง แต่ client ก็กลับไปต้องเรียกหลาย endpoint แล้ว join คำตอบเอง และ `Review` ใน API หนึ่งก็ชี้ไปที่ `Product` ในอีก API ไม่ได้
- **endpoint ที่เขียนมือหนึ่งตัวต่อหน้าจอ** endpoint สำหรับ aggregate ([Gateway Aggregation](../gateway-aggregation/)) รวม call ที่ตายตัวไว้ด้วยกัน และต้องแก้ทุกครั้งที่หน้าจอเปลี่ยน

Federation ทำให้ client ยังเห็น graph เดียว ขณะที่แต่ละทีมเป็นเจ้าของ ship และรันส่วนของตัวเองได้

## ทำงานยังไง

### GraphQL แบบสั้น ๆ

GraphQL service ประกาศ **schema**: object type, field ของแต่ละ type และ type ของ field พวกนั้น บวก root type (`Query` สำหรับอ่าน `Mutation` สำหรับเขียน) client ส่ง **query** ที่เลือก field ที่ต้องการมา server ตรวจ query กับ schema แล้วรันมัน โดยเรียก **resolver** ของแต่ละ field แล้วคืน JSON ที่ `data` มีรูปร่างเหมือนกับที่เลือกมา field ที่ล้มเหลวไม่ได้ทำให้ทั้ง request ล้มเหลว: มันจะกลายเป็น `null` แล้ว response ก็มี entry ใน `errors` พร้อม path ของ field นั้น specification ฉบับล่าสุดคือ กันยายน 2025

### Subgraph, entity และ key

ใน **Apollo Federation 2** service ของแต่ละทีมคือ **subgraph**: GraphQL server ธรรมดาที่ schema import federation directive เข้ามาด้วย `@link` และประกาศ type กับ field ที่ตัวเองเป็นเจ้าของ นี่คือ subgraph สามตัวใน diagram:

```graphql
# Products subgraph
extend schema @link(url: "https://specs.apollo.dev/federation/v2.12", import: ["@key"])

type Query {
  product(id: ID!): Product
}

type Product @key(fields: "id") {
  id: ID!
  name: String!
  price: Float!
}
```

```graphql
# Reviews subgraph
extend schema @link(url: "https://specs.apollo.dev/federation/v2.12", import: ["@key"])

type Product @key(fields: "id") {
  id: ID!
  reviews: [Review!]!
}

type Review {
  rating: Int!
  text: String
}
```

```graphql
# Inventory subgraph
extend schema @link(url: "https://specs.apollo.dev/federation/v2.12", import: ["@key"])

type Product @key(fields: "id") {
  id: ID!
  inStock: Boolean
}
```

- `Product` เป็น **entity**: object type ที่มี `@key` ตัว key ระบุ field ที่ใช้ชี้ instance หนึ่งตัว ในที่นี้คือ `id` ทำให้ subgraph ไหนที่รู้ `id` ของสินค้าก็เพิ่ม field ให้มันได้ Reviews เพิ่ม `reviews` ส่วน Inventory เพิ่ม `inStock` และไม่มีตัวไหนต้องรู้ว่าตัวอื่นเก็บข้อมูลยังไง
- subgraph ทุกตัวที่เพิ่ม field ให้ entity ต้อง implement **reference resolver**: รับ key เข้ามา แล้วคืน field ของ entity นั้นจากข้อมูลของตัวเอง ใน Apollo Server คือ `__resolveReference` ส่วนใน DGS framework ของ Netflix สำหรับ Java และ Kotlin คือ method ที่มี annotation `@DgsEntityFetcher`
- โดย default แต่ละ field เป็นของ subgraph ตัวเดียวเท่านั้น ถ้าอยากให้สอง subgraph resolve มันได้ทั้งคู่ ทั้งสองตัวต้องใส่ `@shareable` ส่วน key field อย่าง `id` เป็น shareable ให้อัตโนมัติ
- version ใน URL ของ `@link` เป็นตัวเลือกว่า schema ใช้ directive ไหนได้บ้าง changelog ของ Apollo ระบุว่า Federation v2.15 (กรกฎาคม 2026) เป็นตัวล่าสุด: เป็น release แบบ long-term support ที่เขียน composition ใหม่ด้วย Rust และไม่ได้เพิ่ม directive ใหม่ ให้ใช้ version ใหม่สุดที่ router ของเรารองรับ

directive อื่นที่จะได้เจอ พร้อม version ที่เริ่มมีมัน:

| Directive | ทำอะไร | ตั้งแต่ |
|---|---|---|
| `@external`, `@requires`, `@provides` | ใช้กับ field ที่ subgraph อื่น resolve: `@requires` ทำให้ router ดึง field พวกนั้นมาก่อนเรียก subgraph นี้ ส่วน `@provides` บอกว่า subgraph นี้คืน field พวกนั้นได้ที่ path หนึ่ง ๆ | v2.0 |
| `@override` | ย้ายความเป็นเจ้าของ field จาก subgraph หนึ่งไปอีกตัว ถ้าใส่ `label` ก็จะค่อย ๆ ย้าย traffic ไป | v2.0 (label ตั้งแต่ v2.7) |
| `@inaccessible`, `@tag` | ซ่อน field จาก API schema ที่ client เห็น และแปะ metadata ไว้ให้ tooling และ contract ใช้ | v2.0 |
| `@composeDirective` | เก็บ custom directive ไว้ใน supergraph | v2.1 |
| `@interfaceObject` | ให้ subgraph เพิ่ม field ให้ entity interface ได้ โดยไม่ต้องกำหนด type ที่ implement มัน | v2.3 |
| `@authenticated`, `@requiresScopes` | authorisation ระดับ router ตามสถานะการ authenticate หรือ JWT scope | v2.5 |
| `@policy` | authorisation ระดับ router ตาม policy ที่กำหนดเอง | v2.6 |
| `@context`, `@fromContext` | ส่งค่าจาก type ที่อยู่สูงขึ้นไปใน query ลงไปเป็น argument ของ field ที่อยู่ลึกลงไป | v2.8 |
| `@cost`, `@listSize` | น้ำหนักสำหรับ demand control (จำกัด cost) | v2.9 |
| `@cacheTag` | ติด tag ให้ข้อมูลใน cache เพื่อให้ invalidate ได้ | v2.12 |

### สัญญาของ subgraph

router ไม่เคยเห็นโค้ดของ subgraph เห็นแค่ protocol เล็ก ๆ ที่ server ทุกตัวที่รองรับ federation ต้อง implement:

- `Query._service { sdl }` คืน schema ของ subgraph รวม federation directive ด้วย เพื่อให้ tooling ดึงไปใช้ทำ composition ได้ มันไม่ได้เป็นส่วนหนึ่งของ schema ที่ compose แล้ว ควรมีแค่ router กับ tooling ที่เรียกมัน
- `Query._entities(representations: [_Any!]!): [_Entity]!` resolve entity ตาม key แต่ละ **representation** เป็น JSON object ที่มี `__typename` กับ key field เช่น `{"__typename": "Product", "id": "42"}` ตัว subgraph จะคืนผลหนึ่งตัวต่อ representation หนึ่งตัว เรียงตามลำดับเดิม หรือคืน `null` ถ้าไม่มี entity นั้น ส่วน `_Entity` เป็น union ของทุก type ใน subgraph ที่มี `@key`

นี่คือการ fetch entity ที่ step 2 ส่งไปหา Reviews:

```graphql
query ($representations: [_Any!]!) {
  _entities(representations: $representations) {
    ... on Product { reviews { rating } }
  }
}
```

โดยมี `{"representations": [{"__typename": "Product", "id": "42"}]}` เป็น variable ตัว `_entities` คืน entity ไหนก็ได้ให้ใครก็ได้ที่รู้ key ของมัน ทำให้ subgraph ต้องให้แค่ router เข้าถึงได้เท่านั้น (ดู *Security* ข้างล่าง)

### Composition และ supergraph

**Composition** รวม schema ของ subgraph ทั้งหมดเป็น **supergraph schema** เดียว: ทุก type และทุก field บวก metadata ที่บันทึกว่า subgraph ไหน resolve field ไหน และด้วย key อะไร client จะเห็น **API schema** ที่สร้างจากมัน โดยไม่มีอะไรที่ติด `@inaccessible`

Composition ยังเช็กด้วยว่าชิ้นส่วนเข้ากันได้ field ที่สอง subgraph resolve ทั้งคู่โดยไม่มี `@shareable` จะล้มด้วย `INVALID_FIELD_SHARING` และ field ที่ type ไม่ลงรอยกันระหว่าง subgraph จะล้มด้วย `FIELD_TYPE_MISMATCH` ตัว `price: String` ของ Inventory ใน step 1 ผิดทั้งสองข้อ เมื่อ composition ล้ม ก็จะไม่มี supergraph ใหม่ออกมา แล้ว router ก็ใช้ตัวล่าสุดที่ compose ผ่านต่อไป ความขัดแย้งเลยค้างอยู่แค่ใน build ที่ก่อมัน

Composition รันได้ในสองที่:

- **ใน pipeline ของเราเอง** ด้วย CLI อย่าง `rover supergraph compose` ที่สร้างไฟล์ supergraph ที่เรา deploy ไปพร้อมกับ router
- **ใน schema registry** (Apollo เรียกแบบนี้ว่า managed federation): subgraph แต่ละตัว publish schema ของตัวเอง registry compose supergraph แล้ว router ก็ดึง version ใหม่ไปใช้โดยไม่ต้อง restart

### Query planning

สำหรับทุก operation ตัว router จะสร้าง **query plan** จาก supergraph: subgraph ไหน resolve field ไหน, fetch ไหนต้องรอตัวอื่น และ fetch ไหนรันพร้อมกันได้ router cache plan ไว้ ทำให้ operation ที่มาซ้ำมักไม่ต้องวางแผนใหม่ สำหรับ query ตัวอย่าง:

1. **Fetch จาก Products** `product(id: 42) { __typename id name price }` Products เป็นเจ้าของ root field และ `__typename` กับ `id` รวมกันเป็น representation ที่ fetch ถัดไปต้องใช้
2. **แบบขนาน** fetch `reviews { rating }` จาก Reviews และ `inStock` จาก Inventory ผ่าน `_entities` โดยส่ง representation นั้นไป
3. **รวม** คำตอบเป็น response เดียวในรูปร่างของ query

query plan ของ Apollo เป็น tree ของ node อย่าง `Sequence`, `Parallel`, `Fetch` และ `Flatten` ตัว `Flatten` รวมผลของการ fetch entity เข้าไปในข้อมูลที่ path หนึ่ง ๆ plan ใช้เวลานานเท่ากับสายที่ยาวที่สุดของ fetch ที่ต้องรอกัน ทำให้ query ที่กระโดดจาก entity ไป entity ข้าม subgraph ต้องเสีย round trip หนึ่งรอบต่อการกระโดดหนึ่งครั้ง

### Router และ subgraph framework

- **Apollo Router** (Apollo): เขียนด้วย Rust เป็น source-available ภายใต้ Elastic License 2.0 ปกติใช้คู่กับ GraphOS registry ของ Apollo ฟีเจอร์หลายตัวของมัน รวมถึง authorisation directive, demand control, safelisting และ response caching ต้องมี GraphOS plan มันยังเรียก REST API ที่ประกาศไว้ใน schema ได้ด้วย Apollo Connectors (`@connect`, Federation v2.10)
- **Cosmo Router** (WunderGraph): เขียนด้วย Go ภายใต้ Apache 2.0 licence และรองรับ Federation v1 และ v2 มันเป็นส่วนหนึ่งของ Cosmo platform ที่เป็น open source และมี registry ของตัวเองกับ CLI `wgc`
- **Hive Gateway** และ **Hive Router** (The Guild): Hive Gateway เป็น gateway ที่เขียนด้วย JavaScript รันบน Node.js, Bun, Deno และ serverless platform ได้ และ stitch schema ได้ด้วย ส่วน Hive Router เขียนด้วย Rust ทั้งสองตัวใช้ MIT licence และทำงานกับ Hive schema registry
- **Fusion** (ChilliCream): gateway บน .NET ที่สร้างบน Hot Chocolate ส่วน model ดั้งเดิมของมันคือ draft specification ของ GraphQL Foundation (ข้างล่าง) และมี connector ที่ทำให้มันรัน Apollo Federation subgraph ได้โดยไม่ต้องแก้ ทำให้ graph เดียวผสมทั้งสองแบบได้
- **Grafbase:** The Guild ซื้อ Grafbase ไปเมื่อเดือนกุมภาพันธ์ 2026 แล้ว gateway ของมันอยู่ใน maintenance mode และ user ถูกแนะนำให้ไปใช้ Hive Router

subgraph เขียนด้วย GraphQL server แทบตัวไหนก็ได้: Apollo Server, **DGS** framework ของ Netflix บน Spring Boot, Hot Chocolate และอีกหลายตัว implement สัญญาของ subgraph ไว้แล้ว

### specification กลางที่ยังทำอยู่

Apollo Federation ถูกกำหนดโดยเอกสารของ Apollo และ subgraph specification ของมัน ส่วน **Composite Schemas Working Group** ของ GraphQL Foundation ที่มีสมาชิกจาก vendor หลายราย รวมถึง Apollo, ChilliCream, The Guild และ WunderGraph กำลังเขียนมาตรฐานกลางอยู่ ในเดือนกันยายน 2026 ตัว draft นี้เปลี่ยนชื่อจาก *Composite Schemas* เป็น **GraphQL Federation specification** ส่วน repository ของมันยังติดสถานะ *Stage 0: Preliminary* อยู่ รายละเอียดเลยยังเปลี่ยนได้ก่อนจะถึงขั้น Draft

model ของมันใกล้กับของ Apollo: **source schema** compose กันเป็น **composite schema** และมี `@key`, `@shareable`, `@provides`, `@external`, `@override` กับ `@inaccessible` ครบ ส่วนที่ต่างให้เห็นคือการ lookup entity แทนที่จะใช้ field พิเศษ `_entities` ตัว source schema จะติด `@lookup` ให้ query field ธรรมดา เช่น `productById(id: ID!)` แล้ว executor ก็เรียก field พวกนั้นเพื่อ fetch entity ตาม key ส่วน Fusion สร้างบน model นี้อยู่แล้ว

## ใช้ตอนไหนดี

- **หลายทีมสร้าง API เดียวกัน** แต่ละทีมเป็นเจ้าของ type และ field ของตัวเอง และ ship ตามจังหวะของตัวเอง ส่วน composition กับ schema check ก็จับความขัดแย้งระหว่างทีมได้ก่อนจะมีอะไรถูก deploy
- **client หลายตัวที่ต้องการต่างกัน** web, mobile และแอปของ partner ต่างเลือก field ที่ตัวเองต้องใช้จาก schema เดียว แทนที่จะขอ endpoint ใหม่ทุกหน้าจอ
- **ข้อมูลที่ข้ามขอบเขตของ service** สินค้า, review และ stock ของมันกลับมาใน request เดียว และ field ใหม่ใน subgraph ไหนก็ตามจะพร้อมให้ client ทุกตัวใช้ทันทีที่ compose ผ่าน
- **GraphQL server ที่ใหญ่เกินกว่าทีมเดียวจะดูแลไหว** การย้าย type ไปเป็น subgraph ทีละตัวทำได้โดยไม่ต้องเปลี่ยน schema ที่ client เห็น หรือ query ของ client เลย

### ตอนไหนไม่ควรใช้

- **ทีมเดียวและ service เดียว** GraphQL server ตัวเดียว หรือ REST API ธรรมดา ให้ผลเหมือนกันโดยไม่ต้องมี router, registry และกติกา composition หน้า federation ของ GraphQL.org ก็แนะนำให้เริ่มจาก schema เดียว แล้วค่อยย้ายไป federation เมื่อความต้องการโตขึ้น
- **client ง่าย ๆ ที่ REST ตอบโจทย์อยู่แล้ว** API ที่เป็นรูปร่าง resource, public API ที่พึ่ง HTTP caching ธรรมดา และ integration แบบ server ถึง server แทบไม่ได้อะไรจาก query language กับ router
- **API ที่มีไฟล์เยอะ** การ stream upload และ download ขนาดใหญ่ผ่าน GraphQL router ทำให้มันติดอยู่กับงานนั้น ให้แจก URL อายุสั้นของ object store แทน ([Valet Key](../valet-key/))
- **API ที่เขียนเยอะหรือเป็น transaction** จุดแข็งของ federation คือการ compose การอ่าน ส่วน mutation field แต่ละตัวถูกรันโดย subgraph ตัวเดียว และการเปลี่ยนที่ข้ามหลาย subgraph ก็ไม่ได้ transaction: ต้องใช้ saga ([Saga Orchestration](../saga-orchestration/)) ไม่ว่าข้างหน้าจะเป็น API แบบไหน
- **ไม่มีใครรันมัน** router, registry และกติกาของ schema ต้องมีเจ้าของ ถ้าไม่มี platform team ตัว graph ที่ใช้ร่วมกันจะค่อย ๆ เสื่อม

### Federation, gateway aggregation หรือ BFF?

| | GraphQL federation | [Gateway aggregation](../gateway-aggregation/) | [Backend for Frontend](../backends-for-frontends/) |
|---|---|---|---|
| ใครเลือกรูปร่างของ response | client เลือกทีละ field ภายใน schema เดียว | ทีมที่เขียน endpoint สำหรับ aggregate | ทีม frontend สำหรับ client ของตัวเอง |
| logic การ join อยู่ที่ไหน | ประกาศไว้ใน schema ของ subgraph ผ่าน key แล้ว router วางแผนแต่ละ query | เขียนมือทีละ endpoint | โค้ดในแต่ละ BFF |
| หน้าจอใหม่ต้องใช้ | query ใหม่ ปกติไม่ต้องแก้ server | endpoint ใหม่หรือแก้ endpoint เดิม | แก้ BFF ของ client นั้น |
| ใครเป็นเจ้าของ | แต่ละ domain team เป็นเจ้าของ subgraph ของตัวเอง ส่วน platform team รัน router | ทีม gateway | ทีม frontend |

ใช้ร่วมกันได้ดี: [API gateway](../api-gateway/) มักวางอยู่หน้า router เพื่อทำ TLS, rate limit และ routing ส่วน BFF เองก็เป็น client ของ federated graph ได้

## ได้อะไร เสียอะไร

- **ทุก request เพิ่มอีกหนึ่ง hop และเพิ่มมากกว่านั้นสำหรับ query ที่ลึก** router มีเวลา process ของตัวเอง และทุกสายของการ fetch entity ที่ต้องรอกันก็เพิ่ม round trip ภายใน data centre อีกรอบ ให้วาง key ไว้ตรงที่ fetch ถัดไปต้องใช้ และดู plan ของ operation ที่ช้า
- **router เป็น infrastructure ที่สำคัญมาก** ทุก query วิ่งผ่านมัน เลยต้องมีหลาย instance ต้องวางแผน capacity และต้องมี alert ถ้า router ล่ม ก็คือทั้ง API ล่ม
- **client เป็นคนเขียน query** query หนึ่งอาจแพงในแบบที่การ review endpoint ไม่มีทางจับได้ บน public graph ทั้ง cost limit, depth limit หรือ safelist ของ operation ไม่ใช่ของเลือกได้
- **HTTP caching ยากขึ้น** query ทั้งหมดไปที่ endpoint เดียว ปกติเป็น POST ทำให้ CDN กับ browser แทบไม่มีอะไรให้ใช้ซ้ำ ส่วน caching ก็ย้ายเข้าไปอยู่ใน router และ subgraph
- **ผลลัพธ์บางส่วนเป็นส่วนหนึ่งของสัญญา** subgraph ที่ช้าหรือล้มเหลวจะกลายเป็น field ที่เป็น `null` บวก `errors` และ client ทุกตัวต้อง render แบบนั้นได้
- **governance กับ tooling เป็นงานจริง** กติกา composition, registry, การ review schema และ naming convention ต้องใช้คน และ tooling ที่สะดวกที่สุดก็มักผูกอยู่กับ platform และ plan ของ vendor รายเดียว

## ข้อควรรู้ตอนลงมือทำ

### Performance

- **Batch การ lookup entity ในทุก subgraph** router ส่ง representation ทั้งหมดของ step หนึ่งใน plan ไปหา subgraph ใน `_entities` call เดียว แต่ subgraph library หลายตัวกลับเรียก reference resolver ทีละ key ถ้าไม่ batch ไว้ สินค้า 100 ตัวก็คือ database query 100 ครั้ง ส่วนถ้าใช้ DataLoader หรือของที่เทียบเท่า ตัว subgraph จะรวมเป็น query `WHERE id IN (…)` ครั้งเดียว Apollo แนะนำให้ใช้ DataLoader ในทุก resolver ไม่ใช่แค่ใน entity resolver
- **ทำ plan ให้ตื้น** เลือก key ที่ entry point ของ query คืนมาอยู่แล้ว เลี่ยงสายที่ subgraph แต่ละตัวต้องรอคำตอบของตัวก่อนหน้า และใช้ `@provides` เฉพาะตรงที่ subgraph มีข้อมูลนั้นจริง ๆ
- **Cache ให้ถูกระดับ** router cache query plan ไว้ ส่วน Apollo Router ยังมี **response caching** ที่เก็บผลของ root field และส่วนที่ subgraph แต่ละตัวเติมให้ entity ไว้ใน Redis ทำให้ query ที่ต่างกันใช้ซ้ำได้ ตัวนี้มาแทน entity cache รุ่นเก่าของ router ส่วนภายใน subgraph ให้ cache การ lookup ที่แพงแบบเดียวกับใน service ทั่วไป ([Cache-Aside](../cache-aside/))
- **Stream ส่วนที่ช้าด้วย `@defer`** client ติด `@defer` ให้ fragment ได้ เพื่อให้ field ที่เร็วมาถึงก่อน incremental delivery ยังเป็นแค่ proposal และยังไม่ได้อยู่ใน GraphQL specification แต่ Apollo Router รองรับแล้วด้วย multipart HTTP response แล้ว client library ก็ต้องเข้าใจแบบนี้ด้วย

### Security

- **ให้แค่ router เรียก subgraph ได้** `_entities` กับ `_service` เป็น protocol ภายใน: subgraph ที่เข้าถึงได้จากข้างนอกจะเปิดให้ใครก็ fetch entity ตาม key และอ่านทั้ง schema ได้ โดยข้ามการเช็กของ router ไปเลย ให้เก็บ subgraph ไว้ใน private network และให้มันเช็กว่าแต่ละ call มาจาก router จริง ด้วย [mutual TLS](../mutual-tls/) หรือ header ที่มี shared secret
- **ปิด introspection ใน production** Apollo Router ปิด introspection มาตั้งแต่แรก คำแนะนำด้าน security ของ GraphQL.org ก็แนะนำแบบเดียวกันสำหรับ production พร้อมกับซ่อนรายละเอียดใน error message
- **จำกัดว่า query หนึ่งแพงได้แค่ไหน** ปฏิเสธ operation ที่ลึกเกิน กว้างเกิน หรือแพงเกิน demand control ของ Apollo ประเมิน cost ของ operation จาก subgraph request ที่มันวางแผนไว้ โดยใช้น้ำหนักตาม IBM GraphQL Cost Directives specification (`@cost`, `@listSize`) แล้วเพิ่ม [rate limit](../rate-limiting/) ต่อ client ซ้อนไว้อีกชั้น
- **เลือกใช้ operation ที่ persist ไว้และเชื่อถือได้** สำหรับแอปของเราเอง ให้ลงทะเบียนทุก operation ไว้ตอน build แล้วให้ router รันแค่ตัวพวกนั้น เป็น safelist ที่เรียกอีกชื่อว่า trusted documents ส่วน automatic persisted queries เป็นฟีเจอร์อีกตัว: มันช่วยประหยัด bandwidth แต่ router จะเพิ่ม operation ไหนก็ได้ที่ได้รับเข้าไป มันเลยไม่ได้จำกัดอะไรเลย
- **Authorise ใน subgraph** การเช็กระดับ router อย่าง `@authenticated`, `@requiresScopes` และ `@policy` ของ Apollo เป็นด่านแรกที่มีประโยชน์ ช่วยกรอง field ที่ผู้เรียกไม่ควรเห็นออกไป แต่ subgraph ที่เป็นเจ้าของข้อมูลก็ยังต้องตัดสินเองว่าใครอ่าน object ไหนและ field ไหนได้ ([Policy-Based Authorization](../policy-based-authorization/))
- **ส่ง identity ของ user ต่อไปด้วย** router validate token ของ client ครั้งเดียว ([JWT Validation](../jwt-validation/)) แล้ว forward ตัว token หรือ claim ที่เลือกไว้ไปให้ subgraph หรือแลกเป็น token ที่แคบกว่าสำหรับแต่ละ subgraph ([Token Exchange](../token-exchange/)) แบบนี้ subgraph แต่ละตัวจะได้ตัดสินใจเองได้

### ล้มเหลวบางส่วนและ error

- ใน GraphQL ตัว field ที่ล้มเหลวจะ resolve เป็น `null` และเพิ่ม entry ใน `errors` พร้อม path ของ field นั้น ถ้า field เป็น non-null ตัว `null` จะเลื่อนขึ้นไปที่ parent ที่ nullable ตัวที่ใกล้ที่สุด ให้ทำ field ที่มาจาก subgraph อื่นเป็น nullable (`inStock: Boolean` ไม่ใช่ `Boolean!`) ไม่งั้น subgraph ตัวเดียวล้มก็ลบทั้ง object ทิ้งได้
- เมื่อ fetch ทั้งก้อนล้มเหลว router จะรายงานไว้ใน `errors` ตัว Apollo Router ใส่ error นั้นไว้ที่ path ของ entity ที่มันกำลัง fetch คือ `["product"]` ใน step 4 และโดย default จะแทน error message ของ subgraph ด้วยข้อความกลาง ๆ รายละเอียดภายในจะได้ไม่รั่ว
- ให้ call ไปหา subgraph แต่ละครั้งมี timeout สั้นกว่าของ client และเลิกเรียก subgraph ที่ล้มเหลวไม่หยุด ([Timeout & Fallback](../timeout-and-fallback/), [Circuit Breaker](../circuit-breaker/))
- client ต้องเตรียมรับทั้ง `data` และ `errors` ใน response เดียวกัน แล้ว render สิ่งที่มาถึง

### Observability

- trace แต่ละ operation จาก router เข้าไปในทุกการ fetch subgraph ด้วย OpenTelemetry แล้ว query ที่ช้าจะบอกได้ว่า fetch ไหนเป็นตัวถ่วง ([Distributed Tracing](../distributed-tracing/)) ส่วน router ของ Apollo, WunderGraph และ The Guild ต่าง export trace และ metric แบบ OpenTelemetry ได้ทั้งหมด
- เก็บ metric ต่อ operation ต่อ client และต่อ subgraph ขอให้ client ตั้งชื่อ operation และบอกว่าตัวเองเป็นใคร เช่นด้วย header ที่บอกชื่อ client: operations check ปกป้องได้แค่ client ที่มันเห็น traffic

### การเปลี่ยน schema, registry และ check

pipeline ของ subgraph แต่ละตัวทำสามอย่างเดียวกัน:

1. **Check** schema ที่เสนอกับ registry: มัน compose กับ subgraph อื่นได้ไหม และมันทำให้ operation ที่ client ส่งมาจริงช่วงหลังพังหรือเปล่า Apollo GraphOS รัน build (composition) check, operations check และ lint check โดย operations check ของมันดู traffic ย้อนหลังหนึ่งสัปดาห์เป็นค่า default ส่วน Hive ถือว่า breaking change ปลอดภัยได้ ถ้าข้อมูลการใช้งานบอกว่าไม่มี client ไหนพึ่งมันอยู่ แล้ว operations check ของ Cosmo ก็อ่าน traffic ของ client ย้อนหลัง 7 วันเป็นค่า default เหมือนกัน
2. **Deploy** subgraph ให้มัน serve schema ใหม่ได้ก่อนที่ router จะส่ง traffic ของ schema นั้นมา
3. **Publish** schema ให้ registry compose supergraph ใหม่ แล้ว router ก็โหลดมัน

คำสั่งคือ `rover subgraph check` กับ `rover subgraph publish` (Apollo), `hive schema:check` กับ `hive schema:publish` (The Guild) และ `wgc subgraph check` กับ `wgc subgraph publish` (WunderGraph)

ถ้าจะลบ field อย่างปลอดภัย ให้ทำ migration แบบ [Expand and Contract](../expand-and-contract/): เพิ่มตัวแทน ติด `@deprecated` ให้ field เก่า ย้าย client ไป แล้วค่อยลบเมื่อ operations check บอกว่าไม่มีใครใช้แล้ว ส่วน mobile app ทำให้เรื่องนี้ช้า เพราะ version เก่ายังติดตั้งอยู่เป็นเดือน ๆ

### ความเป็นเจ้าของและ governance

- **entity หนึ่งตัวมีบ้านเดียว** ทีมที่เป็นเจ้าของ `Product` กำหนด key กับ field หลักของมัน ส่วนทีมอื่นเพิ่ม field ผ่าน key ตกลงเรื่อง key field ให้เร็ว: subgraph ทุกตัวที่เพิ่ม field ให้ entity นั้นพึ่ง key พวกนี้
- **field ที่ใช้ร่วมกันต้องเป็นการตัดสินใจ** review ทุก `@shareable` และเลือกให้ field หนึ่งตัวมีเจ้าของเดียวไว้ก่อน
- **ย้าย field อย่างตั้งใจ** `@override` ส่ง field จาก subgraph หนึ่งไปอีกตัว ถ้ามี label ตัว router จะย้าย traffic ไปเป็นเปอร์เซ็นต์ก่อน
- **platform team สำหรับ graph** ทีมนี้รัน router กับ registry เขียน lint rule และ naming convention และ review การเปลี่ยนที่กระทบทีมอื่น ส่วน domain team เป็นเจ้าของ subgraph ของตัวเอง เหมือนในองค์กร [microservices](../microservices/) ทั่วไป
