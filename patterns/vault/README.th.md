## ปัญหา

service Orders ของ Acme Shop รันเป็น pod บน Kubernetes แต่ละ pod ต้องมี login สำหรับ database PostgreSQL `orders` และ service ก็เก็บ card token ที่ได้มาตอน checkout ไว้ด้วย และ token พวกนี้ห้ามอยู่ใน database เป็น plain text ทางแก้แบบเร็ว ๆ ทุกทางล้วนทิ้ง secret อายุยาวไว้เกลื่อน: password ใน environment variable หรือใน Kubernetes Secret (เป็น base64 ใน manifest และถ้า cluster ไม่ได้เข้ารหัส Secret ตอน at rest ก็ไม่ได้เข้ารหัสใน [etcd](../etcd/) ด้วย) password ที่ฝังไว้ใน image หรือ encryption key ใน configuration ของแอป

ผลคือ password ตัวเดียวที่ใช้ร่วมกันไปโผล่อยู่ในทุก replica ใน log ของ CI และบน laptop ไม่มีใครบอกได้ว่าใครอ่านมันไปบ้าง การ rotate มันแปลว่าต้องเปลี่ยนที่ database และ redeploy ทุก service พร้อมกัน เลยแทบไม่มีใครทำ และสำเนาที่หลุดออกไปก็ยังใช้ได้สำหรับใครก็ตามที่ถือมันอยู่ จนกว่าจะมีคนสังเกตเห็น ส่วน service แต่ละตัวที่เข้ารหัสข้อมูลก็ยังต้องจัดการ key เอง และแต่ละตัวก็ทำไม่เหมือนกัน

สิ่งที่ร้านอยากได้แทนคือ: workload ที่พิสูจน์ตัวตนด้วย identity ที่ platform ให้มันอยู่แล้ว, credential ที่ออกให้ทีละ workload และหมดอายุไปเอง, key ที่แอปใช้ได้โดยไม่ต้องถือมันไว้เลย และบันทึกของทุกการเข้าถึง

## ทำงานยังไง

HashiCorp Vault เป็น server ที่ปกติรันเป็น cluster เล็ก ๆ มันยืนยันตัวตน client จากนั้นเช็ก request กับ policy แล้วค่อยแจก secret หรือทำงานด้าน cryptography ให้ ทุกอย่างที่มันเก็บจะถูกเข้ารหัสก่อนถึง storage ของมัน HashiCorp เป็นส่วนหนึ่งของ IBM ตั้งแต่กุมภาพันธ์ 2025 ส่วน release ปัจจุบันคือ Vault 2.1.1 (กันยายน 2026) หลังจากที่ Vault ย้ายจากสาย 1.x ไปเป็น 2.0 ในเดือนเมษายน 2026

### Barrier, storage และ seal

- **Storage backend** Vault เก็บทุกอย่าง (configuration, policy, token, lease, KV secret, transit key) ไว้ใน storage backend ที่มันถือว่าไว้ใจไม่ได้ ตัวที่แนะนำคือ **integrated storage**: ทุก node เก็บสำเนาเต็มไว้บน disk ของตัวเอง และ node ต่าง ๆ ตกลงกันผ่าน consensus protocol ชื่อ Raft ทำให้ไม่มี database แยกที่ต้องรัน
- **Barrier** ระหว่าง core ของ Vault กับ storage ของมันมี **encryption barrier** คั่นอยู่ ทุกค่าถูกเข้ารหัสตอนออกไปด้วย AES-256 ในโหมด GCM โดยใช้ nonce สุ่มขนาด 96-bit ต่อ object และ authentication tag ของมันจะถูกเช็กตอนกลับเข้ามา data key อยู่ใน keyring และ Vault rotate barrier key เองก่อนที่จะเข้ารหัสด้วย key นั้นไปประมาณ 2<sup>32</sup> ครั้ง ตามขีดจำกัดที่ NIST แนะนำสำหรับโหมดนี้
- **Seal และ unseal** Vault node เริ่มต้นในสถานะ **sealed**: มันเข้าถึง storage ได้แต่ถอดรหัสอะไรไม่ได้เลย keyring ถูกเข้ารหัสด้วย **root key** และ root key ก็ถูกเข้ารหัสด้วย **unseal key** อีกที โดย default `vault operator init` จะแบ่ง unseal key ด้วย Shamir's Secret Sharing เป็น key share 5 ชิ้น ที่ใช้ 3 ชิ้นไหนก็ได้ประกอบกลับคืน แล้ว operator ก็ต้องใส่ share บนทุก node หลัง restart ทุกครั้ง
- **Auto-unseal** ถ้าใช้ auto-unseal ตัวที่ป้องกัน root key จะเป็น cloud KMS หรือ HSM แทน และ node แต่ละตัวจะขอให้มันถอดรหัส root key ตอน start การ initialize เลยคืน **recovery key** มาแทน ใช้อนุญาต operation ที่อ่อนไหวไม่กี่อย่าง เช่นการสร้าง root token ใหม่ แต่ unseal Vault ไม่ได้ node ที่ auto-unseal ไม่สำเร็จจะ retry ทุกไม่กี่วินาที ทำให้ KMS ที่ล่มแค่ทำให้การ start ช้าลงแทนที่จะทำให้พัง แต่การพึ่งพานี้เข้มงวดมาก: ถ้า KMS key ถูกลบ ข้อมูลจะกู้คืนไม่ได้ แม้จาก backup ก็ตาม

node สามตัวของ Acme Shop รันบน Kubernetes ด้วย integrated storage และ AWS KMS auto-unseal (นี่คือ `vault.hcl` ของ `vault-0` ส่วน node อื่นใช้ชื่อและ address ของตัวเอง):

```hcl
storage "raft" {
  path    = "/vault/data"
  node_id = "vault-0"
  retry_join {
    leader_api_addr = "https://vault-1.vault-internal:8200"
  }
  retry_join {
    leader_api_addr = "https://vault-2.vault-internal:8200"
  }
}

seal "awskms" {
  region     = "eu-west-1"
  kms_key_id = "alias/vault-unseal"
}

cluster_addr = "https://vault-0.vault-internal:8201"
api_addr     = "https://vault-0.vault-internal:8200"
```

AWS identity ของ Vault ต้องมี `kms:Encrypt`, `kms:Decrypt` และ `kms:DescribeKey` บน key นั้น

### Auth method: พิสูจน์ว่าคุณคือใคร

**auth method** เช็ก credential ของ client กับระบบที่รู้จัก client นั้นอยู่แล้ว แล้ว map ผลลัพธ์ไปเป็น policy:

- **Kubernetes** pod ส่ง service-account token ของตัวเองมา แล้ว Vault ก็ส่งมันต่อไปที่ **TokenReview** API ของ Kubernetes ตัว API บอกว่ามันใช้ได้ไหม และเป็นของ service account กับ namespace ไหน แล้ว Vault role ก็ผูกชื่อพวกนั้นเข้ากับ policy ถ้าตัว Vault เองรันอยู่ใน cluster มันใช้ service-account token ของตัวเองเรียก TokenReview ได้
- **AWS** workload เซ็น request `sts:GetCallerIdentity` ด้วย IAM credential ของมันแล้วยื่นให้ Vault ตัว Vault ส่งต่อไปที่ AWS STS แล้วเช็ก IAM principal ที่ได้กลับมากับ principal ที่ผูกไว้ใน Vault role ส่วน EC2 instance ก็ login ด้วย identity document ที่เซ็นแล้วของมันได้ด้วย
- **JWT/OIDC** Vault ตรวจ JWT จาก OIDC issuer เช่นระบบ CI หรือ issuer ของ Kubernetes cluster เอง และ sign in ให้คนผ่าน identity provider ของบริษัทใน browser
- **AppRole** role ID กับ secret ID สำหรับเครื่องที่ไม่มี platform identity ตัว secret ID ก็ยังต้องไปถึงเครื่องอย่างปลอดภัยอยู่ดี และนี่คืองานของ response wrapping (ข้างล่าง)
- ตัวอื่น ๆ ครอบคลุมคนและระบบรุ่นเก่า: user name กับ password, LDAP, TLS client certificate และ identity ของ Azure กับ Google Cloud

```sh
vault auth enable kubernetes
vault write auth/kubernetes/config \
    kubernetes_host="https://$KUBERNETES_SERVICE_HOST:$KUBERNETES_SERVICE_PORT"
vault write auth/kubernetes/role/orders \
    bound_service_account_names=orders \
    bound_service_account_namespaces=shop \
    token_policies=orders-app \
    token_ttl=1h
```

### Token และ policy

login ที่สำเร็จจะคืน **token** มา service token ที่เป็นชนิด default ขึ้นต้นด้วย `hvs.` ตั้งแต่ Vault 1.10 ส่วน batch token ที่เบากว่าและไม่ถูกเก็บไว้จะขึ้นต้นด้วย `hvb.` และ token แต่ละตัวมี policy ของมัน, TTL และ maximum TTL (ค่าสูงสุดของทั้งระบบคือ 32 วัน ถ้าไม่ได้ตั้งเป็นอย่างอื่น) และ renew ได้จนถึงค่าสูงสุดนั้น token ต่อกันเป็น tree: revoke ตัวหนึ่งก็ revoke token ที่สร้างจากมันไปด้วย รวมถึงทุก lease ที่ token พวกนั้นได้ไป

**policy** คือรายการของ path พร้อม capability: `create`, `read`, `update`, `patch`, `delete`, `list`, `sudo` และ `deny` บวกกับตัวพิเศษอีกไม่กี่ตัว อะไรที่ไม่มี policy ไหนให้สิทธิ์จะถูกปฏิเสธ และ `deny` ชนะทุกการให้สิทธิ์ ตัว policy `default` ที่มีมาในตัวจะติดไปกับทุก token เว้นแต่ role จะเอามันออก หน้าที่ของมันมีหลายอย่าง เช่นให้ token ดูข้อมูลตัวเอง renew ตัวเอง และ renew lease ของตัวเองได้

```hcl
# vault policy write orders-app orders-app.hcl
path "database/creds/orders-rw" {
  capabilities = ["read"]
}
path "transit/encrypt/orders-key" {
  capabilities = ["update"]
}
```

service Orders เข้ารหัส card token ได้แต่ถอดรหัสไม่ได้ มีแค่ service payments ที่เป็นคนตัดเงินจากบัตร ที่ได้ policy ที่มี `update` บน `transit/decrypt/orders-key`

### Secrets engine

secrets engine ถูก mount ไว้ที่ path ต่าง ๆ และเป็นตัวทำงานจริง:

- **KV v2** เก็บ static secret เช่น API key ของ partner โดยมีเวอร์ชัน: default 10 เวอร์ชันต่อ key มี soft delete กับ undelete, destroy แบบถาวร และการเขียนแบบ check-and-set ที่จะล้มเหลวถ้ามีคนอื่นเปลี่ยน secret ไปก่อน
- **Database** สร้าง database user ให้ทุก request จาก SQL statement ของ role ยืดอายุมันตอน renew และ drop มันทิ้งเมื่อ lease จบ มี plugin สำหรับ PostgreSQL, MySQL และ MariaDB, Microsoft SQL Server, Oracle, [MongoDB](../mongodb/) และ MongoDB Atlas, [Redis](../redis/), Redshift และ Snowflake และอื่น ๆ ส่วน **static role** จะ rotate password ของ user ที่มีอยู่แล้วตามตารางเวลาแทน สำหรับแอปที่รับมือกับ user name ที่เปลี่ยนไปเรื่อย ๆ ไม่ได้
- **PKI** เป็น certificate authority ที่ออก X.509 certificate ตามที่ขอ ผ่าน ACME ก็ได้ เอกสารของมันแนะนำให้ใช้อายุสั้น ทำให้ certificate หมดอายุไปเองแทนที่จะต้อง revoke และ revocation list ก็เล็กอยู่เสมอ
- **Transit** ทำ cryptography กับข้อมูลที่มันไม่ได้เก็บ: encrypt, decrypt และ rewrap, sign และ verify, HMAC, random byte และ data key สำหรับ envelope encryption ส่วนตัว key มีเวอร์ชัน export ไม่ได้เว้นแต่จะสร้างแบบ exportable ไว้ตั้งแต่แรก และชนิด default คือ `aes256-gcm96`
- **Cloud credential** AWS engine คืน credential ต่อ lease: เป็น IAM user ที่มันสร้างแล้วลบ หรือ STS credential จาก assumed role, federation token หรือ session token ก็ได้ มี engine แบบเดียวกันสำหรับ Azure และ Google Cloud

database engine ของ Acme Shop ที่ใช้ user-name template ที่ให้ชื่อสั้น ๆ อย่าง `v-orders-rw-8f2kq7xm` (template default จะมี display name ของ token และ timestamp อยู่ในชื่อด้วย):

```sh
vault secrets enable database
vault write database/config/orders-db \
    plugin_name=postgresql-database-plugin \
    connection_url="postgresql://{{username}}:{{password}}@orders-db.shop:5432/orders" \
    username="vault-admin" password="$INITIAL_PASSWORD" \
    password_authentication="scram-sha-256" \
    username_template="v-{{.RoleName}}-{{random 8 | lowercase}}" \
    allowed_roles="orders-rw"
vault write -f database/rotate-root/orders-db      # now only Vault knows vault-admin's password

vault write database/roles/orders-rw \
    db_name=orders-db \
    creation_statements="CREATE ROLE \"{{name}}\" WITH LOGIN PASSWORD '{{password}}' VALID UNTIL '{{expiration}}'; \
        GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO \"{{name}}\";" \
    default_ttl=1h \
    max_ttl=24h
```

`password_authentication="scram-sha-256"` ทำให้ Vault hash password ก่อนส่ง ทำให้มันไม่โผล่ใน log ของ PostgreSQL ส่วน default จะส่งเป็น plain text แล้วนี่คือฝั่ง transit:

```sh
vault secrets enable transit
vault write -f transit/keys/orders-key                         # aes256-gcm96
vault write transit/encrypt/orders-key plaintext="$(printf '%s' "$CARD_TOKEN" | base64)"
# ciphertext  vault:v1:...   (the app stores this string)
vault write -f transit/keys/orders-key/rotate                  # new data is encrypted with v2
vault write transit/rewrap/orders-key ciphertext="vault:v1:..."  # v1 -> v2 without revealing the plaintext
vault write transit/keys/orders-key/config min_decryption_version=2   # once no v1 rows are left
```

plaintext เข้าไปเป็น base64 และกลับออกมาเป็น base64 ตัว prefix ของ ciphertext บอกเวอร์ชันของ key ทำให้ Vault รู้ว่าต้องใช้ key ไหนถอดรหัส ส่วน `auto_rotate_period` rotate key ตามตารางเวลา (ถี่สุดชั่วโมงละครั้ง)

### Lease: TTL, renew, revoke

dynamic secret ทุกตัวมาพร้อม **lease**: ID ที่ขึ้นต้นด้วย path ที่มันมา (`database/creds/orders-rw/…`), ระยะเวลา และ flag ว่า renew ได้ไหม client renew lease ด้วยระยะเพิ่มที่นับจากตอนนี้ ไม่ได้นับจากตอนจบของ lease ปัจจุบัน และ `max_ttl` ของ role เป็นเพดานว่าการ renew ไปได้ไกลแค่ไหน เมื่อ lease หมดอายุ expiration manager ของ Vault จะ revoke มัน และสำหรับ database engine นั่นแปลว่ารัน revocation statement ของ role ส่วนคำสั่ง `vault lease revoke` จบ lease หนึ่งตัวทันที และ `vault lease revoke -prefix database/creds/orders-rw` จบทุก lease ใต้ path นั้นหลังสงสัยว่ามีการหลุด และการ revoke token ก็ revoke lease ที่สร้างด้วย token นั้นไปด้วย

สำหรับ PostgreSQL ตัว creation statement มักจะจบอายุของ password ใน database ด้วย ผ่าน `VALID UNTIL '{{expiration}}'` การ renew แบบ default ของ plugin จะเลื่อนวันนั้นออกไป (`ALTER ROLE … VALID UNTIL`) และการ revoke แบบ default ของมันจะเอาสิทธิ์ของ user และ `CONNECT` บน database ออกก่อน แล้วค่อย drop role

### Response wrapping

แทนที่จะคืน secret ตรง ๆ Vault เก็บ response ไว้ใน cubbyhole ของ token ใหม่ที่ใช้ได้ครั้งเดียวและมี TTL สั้นได้ (`-wrap-ttl` ใน CLI, `X-Vault-Wrap-TTL` ใน API) แล้วคืนแค่ token นั้นออกไป ผู้รับที่ตั้งใจไว้ unwrap มันได้ครั้งเดียว ถ้า unwrap ไม่สำเร็จเพราะมีคนทำไปแล้ว แปลว่า secret ถูกดักไประหว่างทาง และ incident ก็มองเห็นได้ วิธีนี้เหมาะกับ secret ID ของ AppRole และ credential ตัวแรกอื่น ๆ

### Audit device

**audit device** (ไฟล์, syslog หรือ socket) รับ request และ response ของ Vault API โดยมีข้อยกเว้นไม่กี่ข้อที่เขียนไว้ในเอกสาร ค่า string จะถูกแทนด้วย HMAC-SHA256 ที่ใช้ key แยกต่อ device ทำให้ log แสดงว่ามีการคืน `password` ไปโดยไม่เปิดเผยตัวค่า และ `sys/audit-hash` ให้คนสืบสวนเช็กได้ว่าค่าที่รู้อยู่แล้วโผล่ใน log หรือเปล่า ถ้าเปิด audit device ไว้แต่ไม่มีตัวไหนเขียนได้เลย Vault จะไม่ยอมตอบ request ฉะนั้นให้เปิดอย่างน้อยสองตัว และคอยดูที่ที่มันเขียนลงไป

### เอา secret เข้า Kubernetes

- **Vault Agent Injector** mutating admission webhook ที่เพิ่ม container ของ Vault Agent ให้ pod ที่มี annotation `vault.hashicorp.com/agent-inject: "true"`: มี init container ที่ render secret ก่อนแอป start และ sidecar ที่คอย login, renew และ render secret ใหม่ลงใน volume แบบ in-memory `/vault/secrets`
- **Vault Secrets Store CSI provider** provider สำหรับ Secrets Store CSI driver: secret ที่ระบุไว้ใน `SecretProviderClass` จะถูกอ่านด้วย service account ของ pod แล้ว mount เป็น volume ระหว่างที่สร้าง container ทำให้ pod จะไม่ start จนกว่าจะอ่าน secret เสร็จ
- **Vault Secrets Operator (VSO)** operator ที่ custom resource ของมัน (`VaultStaticSecret`, `VaultDynamicSecret`, `VaultPKISecret`) sync secret ไปเป็น Kubernetes Secret ธรรมดา และ restart Deployment ได้เมื่อ secret เปลี่ยน (`rolloutRestartTargets`)
- นอก Kubernetes ตัว **Vault Agent** ทำแบบเดียวกันบน virtual machine: auto-auth, template, caching และโหมด process-supervisor แอปที่เรียก Vault API เองก็ส่งผ่าน **Vault Proxy** ได้ ส่วน API proxy ของ Vault Agent เองถูก deprecate แล้ว

pod template ของ Deployment Orders (service account `orders` และ namespace `shop` ตรงกับ Kubernetes role ข้างบน):

```yaml
spec:
  template:
    metadata:
      annotations:
        vault.hashicorp.com/agent-inject: "true"
        vault.hashicorp.com/role: "orders"
        vault.hashicorp.com/agent-inject-secret-db: "database/creds/orders-rw"
        vault.hashicorp.com/agent-inject-template-db: |
          {{- with secret "database/creds/orders-rw" -}}
          postgresql://{{ .Data.username }}:{{ .Data.password }}@orders-db.shop:5432/orders
          {{- end }}
        vault.hashicorp.com/agent-inject-token: "true"   # /vault/secrets/token, for the app's transit calls
    spec:
      serviceAccountName: orders
```

agent renew secret ที่ renew ได้เมื่อผ่านไปสองในสามของ lease ก็คือนาทีที่ 40 ของ lease 1 ชั่วโมง และ `max_ttl` 24 ชั่วโมงของ role คือขีดสุดที่การ renew ไปถึงได้ ทำให้ pod ที่รันนาน ๆ ย้ายไปใช้ user ใหม่อย่างน้อยวันละครั้ง และไฟล์ก็เปลี่ยนตาม

### High availability, replication และ edition

- **HA บน integrated storage** Raft leader คือ **active node** ส่วนตัวอื่นเป็น standby ที่ส่ง request ต่อไปให้มันหรือ redirect client ไปหามัน cluster ที่มี voter N ตัวต้องมี quorum ceil((N+1)/2): สาม node รอดจากการพังหนึ่งตัว ห้า node รอดสองตัว และ HashiCorp แนะนำอย่างน้อยห้าตัวสำหรับ production เป็นเลขคี่ follower จะเริ่มเลือกตั้งเมื่อไม่ได้ heartbeat ของ leader หลัง 5 ถึง 10 วินาทีตาม setting default
- **Enterprise** Vault Enterprise (หรือ HCP Vault Dedicated) เพิ่ม **performance standby** ที่ตอบการอ่านเองในเครื่อง, **performance replication** ไปยัง cluster อื่นที่มี token และ lease ของตัวเอง, **disaster-recovery replication**, **namespace** สำหรับ tenant, policy แบบ **Sentinel** และ HSM auto-unseal ผ่าน PKCS#11 พร้อม seal wrapping ส่วน Community edition มี integrated storage, HA ที่มี standby, auto-unseal กับ cloud KMS service, snapshot (`vault operator raft snapshot save`) และ engine ที่อธิบายไว้ข้างบน
- **Managed** **HCP Vault Dedicated** คือ Vault Enterprise ที่ HashiCorp รันให้ใน account เฉพาะบน AWS หรือ Azure โดยมี API, CLI และ UI แบบเดียวกัน

### License และ fork

ตั้งแต่สิงหาคม 2023 release ใหม่ของ Vault ตั้งแต่ 1.15 ขึ้นไปอยู่ภายใต้ **Business Source License 1.1** ใช้ใน production ได้ ยกเว้นการเปิดให้บุคคลที่สามใช้ Vault ไม่ว่าแบบ hosted หรือ embedded ในลักษณะที่แข่งกับเวอร์ชันเสียเงินของ IBM และแต่ละ release จะกลายเป็น MPL 2.0 สี่ปีหลังจากที่ออก ส่วน release ก่อนหน้านั้นยังอยู่ใต้ MPL 2.0 และ **OpenBao** คือ community fork ที่ต่อยอดจากโค้ดนั้นภายใต้ MPL 2.0 เป็นโปรเจกต์ระดับ sandbox ของ OpenSSF ใน Linux Foundation ตัว OpenBao 2.7.1 (ตุลาคม 2026) ยังมี namespace มาตั้งแต่ 2.3.1 (มิถุนายน 2025) โดยที่ใน Vault นี่เป็น feature ของ Enterprise ส่วน auth method และ secrets engine ฝั่ง cloud ของมัน (AWS, Azure, Google Cloud) มาเป็น plugin แยก และตั้งแต่ 2.7.0 กลไก KMS auto-unseal ก็แยกเป็น plugin เหมือนกัน

## อยู่ตรงไหนใน solution

- **Solution** secret สำหรับ microservice บน Kubernetes อย่างที่ Acme Shop, database credential ต่อ service และต่อ pod, การเข้ารหัสระดับ field ของข้อมูลบัตรและข้อมูลส่วนบุคคลด้วย transit, certificate authority ภายในสำหรับ TLS ระหว่าง service, CI/CD pipeline ที่เอา OIDC token ไปแลก cloud credential อายุสั้นแทนการเก็บ key และระบบ secret ระบบเดียวที่มี audit log ชุดเดียวข้ามหลาย cloud และ data centre
- **Pattern ใน catalog นี้** Vault คือครึ่งที่เป็น secret ของ [external configuration store](../external-configuration-store/) ตัว credential อายุสั้นที่ผูกกับ workload identity ที่ยืนยันแล้ว คือสิ่งที่ [zero trust access](../zero-trust-access/) ต้องการระหว่างเครื่องกับเครื่อง และ PKI engine ก็ออก certificate ให้ [mutual TLS](../mutual-tls/) ส่วน dynamic user ทำให้แต่ละ service มี login ของตัวเอง เหมาะกับ [database per service](../database-per-service/) และ Vault Agent ก็รันเป็น [sidecar](../sidecar/) ส่วน path policy ของมันเป็นรูปแบบหนึ่งของ [policy-based authorization](../policy-based-authorization/) และ AWS engine ของมันก็แจก cloud credential อายุสั้นที่ขอบเขตแคบ ตามแนวคิดของ [valet key](../valet-key/)
- **เพื่อนบ้านที่มักเจอ** [Kubernetes](../kubernetes/) และ API server ของมัน, cloud KMS หรือ HSM สำหรับ auto-unseal, database อย่าง [PostgreSQL](../postgresql/), [AWS IAM](../aws-iam/) สำหรับ AWS auth method, AWS engine และสิทธิ์ของ KMS key, identity provider ของบริษัทอย่าง [Keycloak](../keycloak/) สำหรับคน, Terraform สำหรับ configuration และ log pipeline หรือ SIEM สำหรับ audit log แบบใน [centralized logging](../centralized-logging/)
- **Managed offering** HCP Vault Dedicated บน AWS หรือ Azure ส่วน AWS ไม่ได้รัน Vault เป็น service ของตัวเอง: service ของ AWS สำหรับงานพวกนี้คือ AWS Secrets Manager สำหรับ secret และการ rotate, AWS KMS สำหรับ key และการเข้ารหัส และ AWS Certificate Manager สำหรับ certificate โดยทุกตัวใช้ IAM เป็น identity ส่วน OpenBao ต้องดูแลเอง

## ใช้ตอนไหนดี

เลือก Vault หรือ OpenBao เมื่อคุณต้องการ credential ที่สร้างต่อ workload และถูก revoke อัตโนมัติ, encryption as a service ที่ rotate key จากศูนย์กลาง, certificate authority ภายใน หรือระบบ secret ระบบเดียวสำหรับหลาย cloud และ on-premises ที่มี audit trail ชุดเดียว เลือก secrets service ของ cloud ที่คุณใช้ เมื่อ workload อยู่ใน cloud นั้นและส่วนใหญ่ต้องการแค่ static secret ที่ rotate ได้: ไม่มีอะไรต้องรัน unseal หรือ upgrade ส่วน Kubernetes Secret ธรรมดาแค่เก็บค่าไว้: ไม่มีอะไรออกมันให้ทีละ workload หรือทำให้มันหมดอายุ

| | HashiCorp Vault | OpenBao | AWS Secrets Manager | Azure Key Vault | Kubernetes Secrets |
|---|---|---|---|---|---|
| What it is | cluster ที่ดูแลเอง หรือ HCP Vault Dedicated | community fork ของ Vault ที่ดูแลเอง | managed service ของ AWS | managed service ของ Azure | API object ที่มีในตัว |
| Licence | BSL 1.1 ตั้งแต่ 1.15 ส่วน Enterprise เป็นเชิงพาณิชย์ | MPL 2.0 | service เชิงพาณิชย์ | service เชิงพาณิชย์ | Apache 2.0 เป็นส่วนหนึ่งของ Kubernetes |
| Dynamic credentials | database user, cloud credential, certificate ต่อ lease | engine ชุดเดียวกัน (ฝั่ง cloud เป็น plugin) | ไม่มี: rotate secret ที่เก็บไว้ แบบ managed หรือด้วย [Lambda](../aws-lambda/) function | ไม่มี | ไม่มี |
| Static secrets | KV v2 ที่มีเวอร์ชัน | KV v2 ที่มีเวอร์ชัน | มี พร้อม rotate อัตโนมัติ | secret, key และ certificate | มี เป็น base64 ใน object |
| Encryption as a service | Transit | Transit | ไม่มี: นั่นคืองานของ AWS KMS | key ที่เก็บใน vault (ป้องกันด้วย HSM ใน Premium) | ไม่มี |
| Workload identity | Kubernetes, AWS, Azure, Google Cloud, JWT/OIDC, AppRole | Kubernetes, JWT/OIDC, AppRole, certificate และ cloud เป็น plugin | IAM | Microsoft Entra ID กับ Azure RBAC | service account และ RBAC |
| At rest | barrier แบบ AES-256-GCM | barrier แบบ AES-256-GCM | เข้ารหัสด้วย AWS KMS | เข้ารหัสด้วย key ที่ HSM ถือไว้ | ไม่เข้ารหัสใน etcd เว้นแต่จะตั้ง encryption at rest ไว้ |
| Cost (October 2026) | ฟรีภายใต้ BSL ส่วน Enterprise คิดค่า license หรือตามราคา HCP | ฟรี | $0.40 ต่อ secret ต่อเดือน และ $0.05 ต่อ 10,000 API call | คิดต่อ 10,000 operation บวกค่าต่อ key ต่อเดือนสำหรับ key ที่ป้องกันด้วย HSM | ฟรี |

ตัวที่เทียบได้ของ Google Cloud คือ Secret Manager ที่เก็บ secret แบบมีเวอร์ชัน และส่ง message `SECRET_ROTATE` ไปที่ Pub/Sub ตามตารางเวลา โดยปล่อยให้โค้ดของคุณเป็นคน rotate เอง

## ได้อะไร เสียอะไร

- **อยู่บน critical path** pod ที่ต้องการ secret ใหม่จะ start ไม่ได้ระหว่างที่ Vault sealed หรือติดต่อไม่ได้: request จะได้ HTTP 503 ส่วน pod ที่รันอยู่ยังทำงานต่อได้จนกว่า lease จะหมด ให้ cache token และ lease ไว้ใน agent ตั้ง TTL ให้นานกว่าช่วงล่มที่น่าจะเกิดได้ และรันสามหรือห้า node
- **การ unseal เป็นการพึ่งพาที่เลี่ยงไม่ได้** Shamir share ต้องมีคนพร้อมอยู่หลัง restart ทุกครั้ง ส่วน auto-unseal ย้ายการพึ่งพานั้นไปที่ KMS key ที่ถ้าหายไปข้อมูลก็หายตาม รวมถึง backup ด้วย ให้ key มี policy ที่มีคนน้อยมากที่ disable หรือลบมันได้ ตั้ง alert ทั้งสองอย่าง และเก็บ recovery key ไว้ offline
- **ระบบ stateful เพิ่มอีกหนึ่งตัว** Raft quorum, snapshot, upgrade, TLS certificate ของ cluster, disk ของ audit log, เวอร์ชันของ plugin และ telemetry เป็นงานที่คุณต้องรันเอง รวมถึงการ bootstrap ด้วย: initialize, revoke root token ตัวแรก และเขียน policy เป็นโค้ด
- **dynamic secret ย้ายความซับซ้อนไปที่แอป** user name ที่เปลี่ยนทุกวันหรือประมาณนั้น ต้องมีแอปหรือ connection pool ที่อ่าน credential ใหม่แล้ว reconnect ได้ TTL ที่สั้นทำให้ช่วงเวลาที่ password ที่หลุดยังใช้ได้แคบลง แต่ก็คูณจำนวนการ renew และ traffic ของ `CREATE ROLE`/`DROP ROLE` บน database ขึ้นไปด้วย
- **lease และ token งอกเยอะ** pod เป็นพันตัวที่ใช้ TTL สั้นจะสร้าง lease จำนวนมาก และทุก lease คือ state ที่ Vault ต้องเก็บ ต้อง renew และต้อง revoke ทีหลัง Vault Enterprise จำกัดจำนวน lease ต่อ path ได้ด้วย lease count quota ส่วนใน Community edition ให้กำหนด TTL และ role อย่างระวัง
- **audit ขวาง availability** ถ้าไม่มี audit device ที่เปิดอยู่ตัวไหนเขียนได้ Vault จะหยุดตอบ request นี่เป็น default ที่ถูกต้องสำหรับ secrets store แต่ก็ทำให้ปลายทางของ audit กลายเป็นส่วนหนึ่งของการออกแบบ availability
- **license และ vendor** BSL อนุญาตการใช้ใน production เกือบทุกแบบ แต่ไม่อนุญาตบริการแบบ hosted หรือ embedded ที่แข่งกัน และตอนนี้ HashiCorp ก็เป็นของ IBM แล้ว ทีมที่ต้องการ open-source license แบบ OSI จะเลือก OpenBao ที่ feature เริ่มแยกทางจาก Vault แล้ว

## ข้อควรรู้ตอนลงมือทำ

**Bootstrap ครั้งเดียว แล้วล็อกเก็บไว้** รัน `vault operator init` ครั้งเดียว เข้ารหัส recovery-key share ด้วย PGP key ของคนที่ถือแต่ละชิ้น ตั้ง auth method ให้ operator จากนั้นเขียน policy แล้ว revoke root token ตัวแรก เก็บ policy, role และ mount ไว้ใน Terraform หรือเครื่องมืออื่น ทำให้ทุกการเปลี่ยนแปลงถูก review และทำซ้ำได้

**rotate root credential ของ database** `vault write -f database/rotate-root/orders-db` เปลี่ยน password ที่ Vault ใช้จัดการ user ทำให้ไม่มีคนไหนถือสำเนาไว้ ให้ `vault-admin` มีแค่สิทธิ์ที่ creation statement กับ revocation statement ต้องใช้

**บอกแอปเมื่อไฟล์เปลี่ยน** injector จะ render `/vault/secrets/db` ใหม่เมื่อ agent ได้ user ใหม่มา จะให้แอป watch ไฟล์แล้ว reconnect ก็ได้ หรือจะรันคำสั่งหลัง render ด้วย `vault.hashicorp.com/agent-inject-command-db` ก็ได้ ถ้าไม่ทำ pod จะใช้ user ที่ Vault จะ drop ทิ้งตอน lease จบต่อไปเรื่อย ๆ

**ผูก role ให้แน่น** ผูก Kubernetes role แต่ละตัวกับ service account ตัวเดียวใน namespace เดียว และให้แต่ละ workload มี policy ของตัวเอง setting `audience` ของ role เพิ่มการเช็ก audience claim ของ token สำหรับ pod ที่ยื่น projected service-account token ที่ออกมาให้ Vault

**ทำให้การหลุดมีราคาแพง** ใช้ dynamic secret แทน KV entry ถ้าระบบปลายทางรองรับ ตั้ง `password_authentication="scram-sha-256"` สำหรับ PostgreSQL ใส่ `vault lease revoke -prefix` ไว้ใน incident runbook และ restart pod ที่โดนผลกระทบหลัง revoke ทำให้ agent ของมันอ่าน user ใหม่ แทนที่จะถือ user ที่ถูก revoke ไว้ต่อ

**Transit ในทางปฏิบัติ** เก็บ ciphertext เป็น text โดยที่มันยาวกว่า plaintext หลัง rotate ให้ rewrap แถวเก่าใน background แล้วค่อยเพิ่ม `min_decryption_version` ใช้ key แยกตามจุดประสงค์ และให้สิทธิ์ decrypt แค่กับ service ที่ต้องใช้ plaintext

**ดูแล cluster** ทำ backup ด้วย `vault operator raft snapshot save` เป็นประจำและซ้อม restore เปิด audit device สองตัวและส่ง log ไปที่ SIEM ตั้ง alert ที่ seal status, การเปลี่ยน leader และ audit ที่ล้มเหลว และ upgrade ทีละ node
