## ปัญหา

service Catalog ของ Acme Shop เป็นแอป Node.js ที่เขียนด้วย TypeScript จะรันมันได้ เครื่องต้องมี Node.js รุ่นที่ถูกต้อง มี npm package ตรงตาม lockfile เป๊ะ ๆ มี system library อีกนิดหน่อย และมี JavaScript ที่ compile แล้ว ถ้าแต่ละ environment เตรียมกันด้วยมือหรือด้วย script ของใครของมัน ไม่นานก็จะเพี้ยนไปคนละทาง: laptop ใช้ Node.js อีกรุ่น ส่วน staging ได้ patch ของ operating system ที่ production ยังไม่ได้ แล้ว native package ที่ build ผ่านบนเครื่องหนึ่งก็ไปพังบนอีกเครื่อง ทุกครั้งที่ deploy ก็ต้องติดตั้งทุกอย่างใหม่ ทำให้ของที่รันใน production ไม่ได้ตรงกับที่ test มาซะทีเดียว ถ้าให้แต่ละ service มี virtual machine ของตัวเองก็หายตีกัน แต่ต้องจ่ายเป็น operating system ทั้งตัวต่อ service หนึ่ง แถม machine image ก็ build ช้าและ boot ช้า

**container image** แพ็ก service รวมกับทุกอย่างที่มันต้องใช้เหนือ kernel: userland ของ Linux distribution, runtime, dependency และโค้ด แล้ว CI ก็ build มันแค่ครั้งเดียว ทุก environment ก็รัน byte ชุดเดียวกัน โดยระบุตัวด้วย digest ส่วน **container** ที่กำลังรันอยู่ก็คือ Linux process ธรรมดา ๆ ที่ kernel แยกไว้ด้วย namespace และจำกัดด้วย cgroup เลยไม่ต้อง boot อะไรเลย Docker ทำให้วิธีทำงานแบบนี้แพร่หลาย และในปี 2015 ก็ยก image format กับ runtime ของตัวเอง (runc) ให้ Open Container Initiative (OCI) ที่เพิ่งตั้งขึ้นตอนนั้น ทุกวันนี้เครื่องมืออื่นก็ทำตาม specification ของ OCI ด้วย

## ทำงานยังไง

### image คือ layer, config และ manifest

image ประกอบด้วย object สามแบบ แต่ละตัวเก็บเป็น blob และตั้งชื่อด้วย SHA-256 digest ของ byte ในตัวมัน:

- **Layer** layer คือ tar archive ของสิ่งที่เปลี่ยนใน filesystem: ไฟล์ที่เพิ่มหรือแก้ ส่วนการลบจะบันทึกเป็น entry แบบ *whiteout* พอแตก layer ออกมาตามลำดับ ก็จะได้ root filesystem ของ container
- **Config** เอกสาร JSON ที่มีค่าตั้งต้นสำหรับรัน image (command, environment, working directory, user) และ DiffID ของแต่ละ layer (ก็คือ digest ของ archive ก่อนบีบอัด)
- **Manifest** เอกสาร JSON ที่ list config กับ layer ด้วย digest ตัว digest ของ manifest เองเลยแทน image ทั้งก้อน: แก้ byte เดียวใน layer ไหนก็ตาม digest ของ manifest ก็เปลี่ยนตาม ส่วน image แบบ multi-platform จะมี **image index** เพิ่มมา ชี้ไปที่ manifest หนึ่งตัวต่อ platform และ BuildKit ก็ใช้ index ไว้แนบ attestation ของมันด้วย

เฉพาะคำสั่งที่เปลี่ยนไฟล์เท่านั้นที่สร้าง layer คือ `RUN`, `COPY` และ `ADD` ส่วน `USER`, `CMD`, `ENV` และตัวอื่น ๆ เปลี่ยนแค่ config ส่วน image ของ Catalog มี 7 layer ตัว base `node:24-slim` เอามาให้ 5 layer: root filesystem ของ Debian 12 แล้วก็อย่างละหนึ่ง layer สำหรับ user `node`, Node.js, Yarn และ entrypoint script (diagram วาดสี่ตัวหลังนี้เป็นแท่งเดียว และเขียนว่า +3) ส่วน Dockerfile เพิ่มอีก 2 layer คือ production dependency กับแอปที่ compile แล้ว

**tag** อย่าง `catalog:1.4.2` คือชื่อใน repository ที่ชี้ไปที่ manifest หรือ index และย้ายได้ แต่ **digest** อย่าง `sha256:9f2c…` ย้ายไม่ได้ การ deploy ด้วย digest เลยเป็นวิธีที่ทำให้ laptop, staging และ production ใน step 1 รู้ว่ารัน byte ชุดเดียวกัน

### Build: Dockerfile, stage และ cache

```dockerfile
# syntax=docker/dockerfile:1
FROM node:24 AS deps
WORKDIR /src
COPY package*.json ./
RUN npm ci --omit=dev

FROM deps AS build
RUN npm ci
COPY . .
RUN npm run build

FROM node:24-slim
COPY --from=deps /src/node_modules /app/node_modules
COPY --from=build /src/dist /app/dist
USER node
CMD ["node", "/app/dist/server.js"]
```

สอง **stage** แรกเริ่มจาก image `node:24` ตัวเต็ม ที่มี compiler และ build tool ครบ: `deps` ติดตั้งแค่ production dependency ส่วน `build` เพิ่ม dev dependency (รวมถึง TypeScript) แล้ว compile `src/` ออกมาเป็น `dist/` ส่วน stage สุดท้ายเริ่มใหม่จาก `node:24-slim` ที่เล็กกว่ามาก แล้ว copy มาแค่สอง directory ที่ต้องใช้ ทำให้ทั้ง compiler และ dev dependency ไม่หลุดเข้าไปใน image ที่ส่งออกไปจริง ส่วน BuildKit ตัว builder ตั้งต้นของ Docker Desktop และ Docker Engine จะ build แค่ stage ที่ target ต้องพึ่ง และรัน stage ที่ไม่ขึ้นต่อกันไปพร้อม ๆ กัน

ผลของทุกขั้นถูก **cache** ไว้ สำหรับ `COPY` และ `ADD` ตัว builder จะคำนวณ checksum ของไฟล์ที่ copy (เวลาแก้ไขไฟล์ไม่นับ) ส่วน `RUN` มันเทียบแค่ string ของคำสั่ง ทำให้ builder ไม่มีทางรู้ว่า package registry มีของใหม่กว่าให้แล้ว พอขั้นไหน cache miss ทุกขั้นหลังจากนั้นใน stage เดียวกันก็จะรันใหม่หมด นี่คือเหตุผลที่ Dockerfile copy ไฟล์ package แล้วติดตั้ง dependency ก่อน copy source ส่วนใน step 2 มีแค่ `src/price.ts` ที่เปลี่ยน ทำให้ `COPY . .`, `npm run build` และ `COPY --from=build` ตัวสุดท้ายรันใหม่ ส่วนที่เหลือมาจาก cache ทั้งหมด แล้ว 1.4.2 ก็ต่างจาก 1.4.1 แค่ layer เดียว

`docker buildx build --push` ส่งผลลัพธ์ตรงไปที่ registry เลย ส่วน CI runner ที่เริ่มจากว่างเปล่าทุกรอบจะไม่มี cache ให้ใช้ซ้ำ ให้ export cache ด้วย `--cache-to` แล้วอ่านกลับด้วย `--cache-from` (มี backend แบบ registry, GitHub Actions, S3 และ local) ส่วน BuildKit ก็ยังแนบ provenance attestation แบบย่อไว้กับ image เป็นค่าตั้งต้น และแนบ SBOM ให้ถ้าสั่งด้วย `--sbom=true`

### Registry: push, pull, tag และ digest

registry ทำตาม OCI Distribution Specification ตอน push ตัว client จะถามก่อนว่า registry มี blob แต่ละตัวอยู่แล้วหรือยัง ด้วย `HEAD` request หนึ่งครั้งต่อ digest แล้วอัปโหลดแค่ตัวที่ขาด ถ้า blob อยู่ใน repository อื่นของ registry เดียวกันแล้ว ก็ *mount* มาแทนการอัปโหลดได้ จากนั้นมันก็อัปโหลด manifest แล้วชี้ tag ไปที่ manifest นั้น ส่วน pull ทำกลับกัน: ดึง manifest ด้วย tag หรือ digest แล้วดาวน์โหลดแค่ layer ที่ host ยังไม่มี (ค่าตั้งต้นของ Docker Engine คือดาวน์โหลดทีละ 3 layer และอัปโหลดทีละ 5 layer) ใน step 2 ตัว ECR มีอีก 6 layer อยู่แล้ว และ host-1 ก็มีอยู่แล้วจาก 1.4.1 ทำให้การส่งแต่ละครั้งย้ายแค่ layer เดียว

**Amazon ECR** เก็บ private repository แยกตาม account และ Region ตัว client ยืนยันตัวตนผ่าน IAM: `aws ecr get-login-password` คืน token ให้ `docker login` ใช้ได้ 12 ชั่วโมง ส่วน repository ตั้งให้ tag เป็น **immutable** ได้ (แล้ว push tag ที่มีอยู่แล้วจะพังด้วย `ImageTagAlreadyExistsException`) โดยกำหนดข้อยกเว้นได้ถ้าต้องการ ส่วน ECR ก็ scan image ด้วย **basic scanning** (ช่องโหว่ของ operating system) หรือ **enhanced scanning** ผ่าน Amazon Inspector (package ของ operating system และของภาษา ทั้งตอน push และต่อเนื่อง) มี lifecycle policy ที่ลบ image เก่าตามอายุ มี pull-through cache rule ที่ mirror registry ต้นทางอย่าง Docker Hub โดยเก็บ credential ไว้ใน AWS Secrets Manager และมี managed signing ที่ใช้ AWS Signer sign image ให้อัตโนมัติ

**Docker Hub** จำกัดจำนวน pull โดย ณ ตุลาคม 2026 ตัว client ที่ไม่ได้ login ได้ 100 pull ต่อ 6 ชั่วโมง นับต่อ IPv4 address หรือต่อ IPv6 subnet /64 ส่วน account Personal แบบฟรีได้ 200 ต่อ 6 ชั่วโมง แล้ว account Pro, Team และ Business ไม่จำกัด แต่อยู่ภายใต้ fair use การ pull หนึ่งครั้งคือการดาวน์โหลด manifest หนึ่งตัว image แบบ multi-architecture นับหนึ่งครั้งต่อ architecture และการเช็กด้วย `HEAD` ไม่นับ ส่วน CI runner ที่อยู่หลัง NAT address เดียวกันจะใช้ quota แบบไม่ login ร่วมกัน เพราะฉะนั้นให้ login หรือ mirror base image ไว้ เช่นผ่าน pull-through cache ของ ECR

### Run: Docker Engine, containerd และ runc

`docker run` เป็น call จาก client ตัว CLI ส่งมันไปที่ **dockerd** (daemon ของ Docker Engine) แล้ว dockerd ก็ปล่อยงานสร้าง เริ่ม และหยุด container ให้ **containerd** ส่วน containerd รันแต่ละ container ผ่าน shim ที่เรียก **runc** อีกที runc คือ runtime ตั้งต้นของมัน และเป็นตัวที่ Docker ยกให้ OCI ตัว runc อ่าน bundle ของ container คือ root filesystem กับ `config.json` ที่ list namespace, cgroup limit, mount, capability และ seccomp filter แล้วตั้งค่าทั้งหมดนั้น จากนั้นก็เริ่ม `node` เป็น process แรกของ container ส่วนตั้งแต่ Engine 29.0 การติดตั้งใหม่จะเก็บ image ไว้ใน image store ของ containerd ด้วย ตัวนี้ใช้ snapshotter ของ containerd แทน storage driver รุ่นเก่าของ Docker

บน node ของ Kubernetes ไม่มี dockerd: kubelet คุยกับ containerd หรือ CRI-O ผ่าน **Container Runtime Interface** (CRI) ตัว Kubernetes เอา integration กับ Docker ที่ติดมาในตัว (dockershim) ออกไปในเวอร์ชัน 1.24 (พฤษภาคม 2022) ส่วน image ที่ build ด้วย `docker build` รันได้ทุก CRI runtime โดยไม่ต้องแก้อะไร เพราะมันเป็น OCI image และตัว Docker Engine เองก็ยังให้บริการ cluster ได้ผ่าน adapter cri-dockerd

OCI ออกมาตรฐานสามตัวที่อยู่ข้างใต้ (ณ ตุลาคม 2026): Image Format Specification v1.1.1 (มีนาคม 2025), Runtime Specification v1.3.0 (พฤศจิกายน 2025) และ Distribution Specification v1.1.1 (มกราคม 2025) ส่วน release ปัจจุบันของ stack นี้คือ Docker Engine 29.8.2 (30 กันยายน 2026), containerd 2.4 และ runc 1.5

### Namespace: container มองเห็นอะไรได้บ้าง

Linux มี namespace 8 แบบ: cgroup, IPC, network, mount, PID, time, user และ UTS ตัว Docker ให้แต่ละ container มี namespace **pid**, **net**, **mnt**, **uts** และ **ipc** ใหม่ และบน host ที่ใช้ cgroup v2 ก็ได้ namespace **cgroup** ส่วนตัวด้วย (ค่าตั้งต้นของ dockerd) ผลคือ `node` เป็น PID 1 และเห็นแค่ process ของตัวเอง มี network interface ของตัวเองที่ต่อกับ bridge บน host มี mount table ของตัวเองที่มี root อยู่บน layer ของ image และมี hostname ของตัวเอง ถ้าไม่ได้ตั้งเอง hostname ก็คือ ID ของ container ส่วน namespace **user** ไม่ได้ใช้เป็นค่าตั้งต้น (ดูหัวข้อ security ด้านล่าง)

การเป็น PID 1 มีจุดที่ต้องระวัง: kernel จะส่ง signal ให้ process แรกของ namespace ก็ต่อเมื่อ process นั้นติดตั้ง handler สำหรับ signal นั้นไว้ ยกเว้น SIGKILL ตัว `docker stop` ส่ง SIGTERM แล้วพอหมด grace period ก็ส่ง SIGKILL ทำให้แอป Node.js ที่ไม่ได้ handle SIGTERM จะเมินมัน แล้วโดน kill ตอนหมด grace period แทนที่จะปิดตัวอย่างเรียบร้อย ให้ handle signal ในแอป หรือเริ่ม container ด้วย `--init` ที่จะเพิ่ม init process ตัวเล็ก ๆ ที่คอยส่งต่อ signal และเก็บกวาด child process

### cgroup: container ใช้อะไรได้แค่ไหน

คำสั่งใน step 3 ตั้ง limit ที่ runc เขียนลง cgroup (version 2) ของ container:

- `--cpus=0.5` คือ CFS bandwidth quota 50,000 µs ในทุกช่วง 100,000 µs ที่เขียนลง `cpu.max` เป็น `50000 100000` ถ้า container อยากได้มากกว่านี้ก็จะโดน **throttle** จนถึงช่วงถัดไป แต่ไม่โดน kill
- `--memory=512m` กลายเป็น `memory.max` (536870912 byte) พอ cgroup ใช้ถึงค่านี้และ kernel เรียกคืน memory ได้ไม่พอ **OOM killer** ก็จะเลือก process หนึ่งใน cgroup นั้นแล้วส่ง SIGKILL ไป ถ้าตัวที่โดนคือ process หลักของ container ตัว container ก็จะจบด้วย code 137 (128 + 9 โดย 9 คือเลข signal ของ SIGKILL) แล้ว `docker inspect` ก็แสดง `OOMKilled: true`
- `--memory-swap=512m` ที่ตั้งเท่ากับ `--memory` ทำให้ container ไม่ใช้ swap เลย ถ้าไม่ตั้ง container ก็อาจใช้ swap ได้เท่ากับ memory limit ของมันบน host ที่มี swap

`--pids-limit` ก็จำกัดจำนวน process ได้ด้วย ตัว Docker Engine 29.0 ประกาศ deprecate cgroup v1 แล้ว แต่ Docker จะยังรองรับไปจนถึงอย่างน้อยพฤษภาคม 2029

### Storage และ network

layer ของ image อ่านได้อย่างเดียวและใช้ร่วมกัน: ทั้งสอง container ใน step 3 ใช้ชุดเดียวกันบน disk แต่ละ container เพิ่ม **writable layer** บาง ๆ ไว้ข้างบนหนึ่งชั้น ถ้าใช้ driver overlay2 การเขียนไฟล์จาก layer ของ image ครั้งแรกจะ copy ไฟล์ทั้งไฟล์ขึ้นมาไว้ใน writable layer (*copy-on-write*) ส่วนการลบจะบันทึกเป็น whiteout งานที่เขียนหนัก ๆ เลยช้า และ writable layer ก็โดนลบไปพร้อม container ข้อมูลที่ต้องอยู่นานกว่า container ให้เก็บไว้ใน **volume** เพราะเนื้อหาของ volume อยู่นอกวงจรชีวิตของ container ทุกตัว ใช้ mount แบบ **tmpfs** สำหรับพื้นที่ทดชั่วคราว และใส่ `--read-only` ถ้าอยากให้ root filesystem อ่านได้อย่างเดียวทั้งหมด สำหรับ service อย่าง Catalog ยังไง state ก็ควรอยู่นอก host อยู่แล้ว คือใน database หรือ object store

network namespace ของแต่ละ container มี interface ของตัวเอง ถ้าไม่สั่งเป็นอย่างอื่น Docker จะต่อมันเข้ากับ network `bridge` ตั้งต้น ในนั้น container หากันเจอได้แค่ด้วย IP address แต่บน bridge network ที่สร้างเอง (`docker network create`) container จะหากันเจอด้วยชื่อได้ด้วย ผ่าน DNS ที่ติดมากับ Docker ไม่มีอะไรใน container ที่เข้าถึงได้จากนอก host จนกว่าจะ publish port: `-p 8080:3000` map port 8080 บน host ไปที่ port 3000 ใน container ผ่าน firewall rule ที่ Docker เขียนไว้บน host

### Security: ทุกตัวใช้ kernel เดียวกัน

ทุก container บน host หนึ่งใช้ kernel ของ host ร่วมกัน ทำให้ kernel คือขอบเขตของการแยกตัว ค่าตั้งต้นของ Docker บีบสิ่งที่ container ขอจาก kernel ได้ให้แคบลง: ให้ Linux capability แค่ list สั้น ๆ แทนที่จะได้ครบชุดแบบ root และมี seccomp profile ที่บล็อก system call ราว 44 ตัวจากทั้งหมดกว่า 300 ตัว การ harden ไปได้ไกลกว่านั้นอีก: ใช้ `USER` ที่ไม่ใช่ root (ในที่นี้คือ `node`) ใช้ `--cap-drop=ALL` แล้วเพิ่มกลับแค่ capability ที่แอปต้องใช้ ใส่ `--read-only` และ `--security-opt no-new-privileges` ส่วน **user namespace** map root ใน container ไปเป็น user ID ที่ไม่มีสิทธิ์พิเศษบน host: `userns-remap` ทำแบบนี้ให้ container แต่ตัว dockerd เองยังรันเป็น root ส่วน **rootless mode** รันทั้ง daemon และ container โดยไม่ใช้ root เลย ถ้า tenant ไม่ไว้ใจกัน ให้ครอบ workload ด้วยขอบเขตที่แข็งแรงกว่านี้: gVisor ดัก system call ของ container แล้วจัดการเอง ส่วน Kata Containers รัน container ใน virtual machine ขนาดเบา

image คือซอฟต์แวร์ที่เราส่งออกไป ทำให้ supply chain ของมันต้องดูแลเท่ากับโค้ด: สร้าง SBOM, scan ตอน push และ scan ต่อเรื่อย ๆ, sign digest, verify signature ก่อน deploy และ pin base image ด้วย digest ตัว `cosign` ของ Sigstore sign แบบ keyless: มันใช้ key ชั่วคราวกับ certificate ที่ผูกกับ OIDC identity ของ CI workflow แล้วบันทึกการ sign ไว้ใน transparency log สาธารณะ ส่วน Docker Content Trust ฟีเจอร์ sign รุ่นเก่าของ Docker ถูกเอาออกจาก Docker CLI ไปแล้วใน Engine 29.0

## อยู่ตรงไหนใน solution

- **Solution** เป็นหน่วยของการ deploy สำหรับ service บน [Kubernetes](../kubernetes/) (Amazon EKS) และ Amazon ECS (บน EC2 instance หรือ AWS Fargate) ใช้แพ็ก function ของ [AWS Lambda](../aws-lambda/) เป็น container image ได้ถึง 10 GB ก่อนบีบอัด โดยเก็บไว้ใน Amazon ECR ใน Region เดียวกับ function ใช้ใน CI pipeline ที่ build, test และ scan ภายใน container และใช้ตอน dev บนเครื่องด้วย Docker Desktop กับ Docker Compose ที่รัน service ไว้ข้าง ๆ database และ cache ของมัน
- **Pattern ที่มัน implement หรือช่วยรองรับ** [Immutable infrastructure](../immutable-infrastructure/): release หนึ่งคือ image ใหม่ ไม่ใช่การแก้ image ที่รันอยู่ ส่วน [Blue-green deployment](../blue-green-deployment/), [rolling update](../rolling-update/) และ [canary release](../canary-release/) ย้าย traffic จาก image digest หนึ่งไปอีกตัว แล้ว [GitOps](../gitops/) ก็เก็บ digest ที่แต่ละ environment ควรรันไว้ใน Git ตัว [sidecar](../sidecar/) คือ container ตัวที่สองที่ใช้ network namespace ของ pod ร่วมกับแอป ส่วน cgroup limit ให้แต่ละ container มี [bulkhead](../bulkhead/) ของตัวเองบน host ที่ใช้ร่วมกัน และ container ก็เป็นตัวต่อพื้นฐานที่ใช้กันทั่วไปของ [microservices](../microservices/)
- **เพื่อนบ้านที่มักเจอ** ระบบ CI ที่มี build cache, registry อย่าง Amazon ECR, Docker Hub, GitHub Container Registry หรือ Harbor, ตัว scan และตัว sign image, orchestrator, secrets manager และ agent เก็บ log และ metric ที่ดึงสิ่งที่ container เขียนออก stdout และ stderr
- **Managed offering** Amazon ECR คือ registry ของ AWS ส่วน Amazon ECS, AWS Fargate และ Amazon EKS รัน container แล้ว Lambda ก็รัน container image เป็น function ส่วน Docker Hub คือ registry ของ Docker เอง
- **License** Docker Engine (โปรเจกต์ Moby), Docker CLI, containerd และ runc เป็น open source ภายใต้ Apache License 2.0 แต่ Docker Desktop ไม่ใช่: ภายใต้ Docker Subscription Service Agreement มันฟรีสำหรับธุรกิจขนาดเล็ก (พนักงานน้อยกว่า 250 คนและรายได้ต่อปีน้อยกว่า US$10 ล้าน) การใช้ส่วนตัว การศึกษา และโปรเจกต์ open source ที่ไม่ใช่เชิงพาณิชย์ ส่วนการใช้งานแบบมืออาชีพในองค์กรที่ใหญ่กว่านั้นและหน่วยงานรัฐต้องซื้อ subscription Pro, Team หรือ Business ตัวเลือกอื่นที่นิยมก็เป็น Apache 2.0 เหมือนกัน: **Podman** (6.1 ณ ตุลาคม 2026) รัน image ชุดเดียวกันได้โดยไม่ต้องมี daemon และรันแบบ rootless ก็ได้ มี command line ที่เข้ากับ Docker (`alias docker=podman` ใช้ได้เกือบทุกกรณี) และมี Podman Desktop ไว้ใช้บน laptop ส่วน **Buildah** build OCI image ได้โดยไม่ต้องมี daemon

## ใช้ตอนไหนดี

แพ็ก service เป็น container image เมื่อมันต้องรันเหมือนกันทั้งบน laptop, ใน CI และในหลาย environment เมื่อ deploy บ่อยและอยากให้ rollback เป็นแค่การเปลี่ยน digest เมื่อหลาย service ใช้ host ร่วมกันแต่ต้องมี dependency และ resource limit ของตัวเอง และเมื่อจะมี orchestrator อย่าง Kubernetes หรือ Amazon ECS มารันมัน อย่าถือว่า container อย่างเดียวคือขอบเขต security ระหว่าง workload ที่ไม่ไว้ใจกัน: ให้ใช้ virtual machine, microVM หรือ sandboxed runtime และสำหรับงานสั้น ๆ ที่ขับด้วย event ตัว function อาจง่ายกว่า เพราะ Lambda รัน image ของเราได้โดยไม่มี host หรือ cluster ให้ต้องดูแล

| | Virtual machine | Container | microVM (Firecracker) | Function (AWS Lambda) |
|---|---|---|---|---|
| ขอบเขตการแยกตัว | hypervisor โดยแต่ละ VM รัน kernel ของตัวเอง | namespace, cgroup, capability และ seccomp บน kernel ตัวเดียวที่ใช้ร่วมกัน | hypervisor (KVM) ที่มี device model แบบขั้นต่ำ โดยแต่ละ microVM รัน guest kernel ของตัวเอง | ของ AWS เอง: Lambda สร้างอยู่บน Firecracker microVM |
| สิ่งที่ส่งออกไป | machine image ที่มี operating system ทั้งตัว | OCI image: userland, runtime, dependency และโค้ด | guest kernel กับ root filesystem | ไฟล์ .zip หรือ OCI image ขนาดไม่เกิน 10 GB พร้อม handler |
| การเริ่มหนึ่งตัว | boot operating system | เริ่ม process โดยไม่มีอะไรต้อง boot | boot guest kernel แบบขั้นต่ำ ภายในไม่ถึง 125 ms ตามที่โปรเจกต์บอก | cold start สร้าง environment แล้ว request ถัด ๆ ไปก็ใช้ตัวเดิม |
| overhead ต่อ instance | guest operating system และ memory ของมัน | process หนึ่งตัว โดย layer ของ image ใช้ร่วมกันบน disk | memory ไม่ถึง 5 MiB ต่อ microVM ตามที่โปรเจกต์บอก | มองไม่เห็น: จ่ายตาม request และตาม GB-second |
| รันที่ไหน | EC2 หรือ hypervisor ของเราเอง | Linux host ตัวไหนก็ได้, Amazon ECS, Amazon EKS, AWS Fargate | ภายใน platform อย่าง Lambda และ Fargate หรือบน host ของเราเองที่มี KVM | บน AWS เท่านั้น |
| เลือกเมื่อ | ต้องใช้ kernel หรือ operating system อื่น ต้องแยก tenant กันแน่นหนา หรือเป็นระบบ legacy | แพ็กและรัน service แบบอัดแน่น พร้อม deploy ที่เร็วและทำซ้ำได้ | platform แบบ multi-tenant ที่ต้องแยกตัวระดับ VM แต่เร็วเกือบเท่า container | งานสั้น ๆ ที่ขับด้วย event และไม่มีอะไรข้างใต้ให้ต้องรัน |

ตัวเลขของ Firecracker มาจากเว็บของโปรเจกต์ การใช้ใน Lambda และ Fargate มาจาก paper ของ NSDI 2020 ส่วนลิมิตขนาด image ของ Lambda มาจากหน้า quota ของมัน (ตุลาคม 2026)

## ได้อะไร เสียอะไร

- **kernel ใช้ร่วมกัน** ช่องโหว่ใน kernel, container แบบ privileged หรือการ mount แบบไม่ระวัง (ตัวอย่างคลาสสิกคือ Docker socket ที่คุม daemon และเท่ากับคุม host) ทำให้ container เอื้อมไปถึงตัวข้าง ๆ หรือ host ได้ ค่าตั้งต้นก็ช่วยได้ แต่โค้ดที่เราไม่ไว้ใจต้องมีขอบเขตระดับ VM
- **filesystem เป็นของชั่วคราว** อะไรที่เขียนไว้นอก volume จะหายไปพร้อม container และ copy-on-write ทำให้งานที่เขียนเยอะช้า ส่วน state ต้องอยู่ใน volume หรือ store แบบ managed ทำให้ service ที่มี state เป็นส่วนที่ยาก
- **image คือซอฟต์แวร์ที่ต้องดูแล** base image พา package ของ distribution มาพร้อมช่องโหว่ของมัน และ tag อย่าง `node:24-slim` ก็ถูก build ใหม่ทุกครั้งที่มี fix ออกมา ทำให้ Dockerfile เดิมได้ image คนละตัวในเดือนหน้า การ pin base ด้วย digest ทำให้ build ซ้ำได้ผลเดิม แต่ก็แปลว่าต้องตั้งใจอัปเดต pin เองถึงจะได้ fix
- **limit มีทั้งดีและเสีย** CPU quota ที่ตึงเกินไปจะ throttle ช่วง burst เพราะ container ที่ใช้ quota หมดแล้วต้องรอช่วง 100 ms ถัดไป ส่วน memory limit ที่ตึงก็แปลว่าโดน OOM kill แต่ถ้าหลวมไปก็เปลือง host ให้กำหนดขนาดจากค่าที่วัดได้จริง
- **registry เข้ามาอยู่ใน critical path** ทุกการ deploy และทุกการ scale out ต้อง pull จากมัน ทำให้ availability, rate limit (โดยเฉพาะของ Docker Hub) และขนาดของ image สำคัญหมด
- **ชิ้นส่วนเยอะขึ้น** container ตัวเดียวง่าย แต่ร้อยตัวต้องมี orchestrator, registry, image policy, ระบบเก็บ log และการ patch host แล้ว Docker Desktop ก็มีค่าใช้จ่ายในองค์กรที่ใหญ่ขึ้นด้วย

## ข้อควรรู้ตอนลงมือทำ

- **ทำ image ให้เล็กและเฉพาะทาง** เริ่มจาก base แบบ slim หรือ distroless ใช้ multi-stage build และเพิ่มไฟล์ `.dockerignore` (ในที่นี้คือ `node_modules`, `dist`, `.git` และไฟล์ `.env` บนเครื่อง) ให้ build context เล็ก และไม่มี secret หลุดเข้าไป
- **เรียง Dockerfile ให้เข้ากับ cache** copy ของที่ไม่ค่อยเปลี่ยนอย่าง lockfile แล้วติดตั้ง dependency ก่อน จากนั้นค่อย copy source ที่เปลี่ยนทุก commit
- **อย่าอบ secret ลงใน image** build argument และ environment variable ติดอยู่ใน image ไปตลอด ให้ส่ง secret ตอน build ด้วย `docker buildx build --secret` แล้วอ่านด้วย `RUN --mount=type=secret` ส่วน secret ตอน runtime ให้ส่งเข้า container จาก secrets manager
- **รันพร้อม limit และให้สิทธิ์น้อยที่สุดเท่าที่ทำได้** image ตั้ง `USER node` ไว้แล้ว ส่วนคำสั่ง run ด้านล่างเพิ่ม limit จาก step 3, root filesystem แบบอ่านอย่างเดียวพร้อม tmpfs สำหรับ `/tmp`, ไม่ให้ capability เลย และไม่ให้ยกระดับสิทธิ์ ตัว user `node` เขียนลง `/app` ไม่ได้ และนั่นก็คือสิ่งที่เราต้องการ

```sh
ECR=111122223333.dkr.ecr.us-east-1.amazonaws.com
IMAGE=$ECR/catalog@sha256:9f2c…   # the full digest CI printed for 1.4.2

aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin "$ECR"
docker run -d --name catalog-1 \
  --cpus=0.5 --memory=512m --memory-swap=512m --pids-limit=256 \
  --read-only --tmpfs /tmp \
  --cap-drop=ALL --security-opt no-new-privileges \
  "$IMAGE"

# Why did catalog-2 stop?
docker inspect --format '{{.State.OOMKilled}} {{.State.ExitCode}}' catalog-2
# true 137
```

- **จัดการตอน shutdown** ดัก SIGTERM ในแอป หยุดรับงานใหม่ ทำงานที่ค้างอยู่ให้เสร็จ แล้ว exit ก่อนหมด grace period หรือไม่ก็ใส่ `--init`
- **เขียน log ออก stdout และ stderr** แล้วปล่อยให้ engine หรือ orchestrator ส่ง log ต่อไป อย่าเขียนไฟล์ log ลงใน writable layer
- **บอก Kubernetes แบบเดียวกัน** container spec ด้านล่างให้ Catalog มี request ที่ scheduler ใช้ และมี limit กับการ harden ชุดเดียวกัน ถ้าตั้ง `runAsNonRoot` ตัว kubelet จะไม่ยอมเริ่ม container เป็น UID 0 ส่วน `runAsUser: 1000` ระบุ UID ของ user `node` ไว้ชัด ๆ

```yaml
containers:
  - name: catalog
    image: 111122223333.dkr.ecr.us-east-1.amazonaws.com/catalog@sha256:9f2c…
    resources:
      requests: { cpu: 250m, memory: 256Mi }
      limits: { cpu: 500m, memory: 512Mi }
    securityContext:
      runAsNonRoot: true
      runAsUser: 1000
      readOnlyRootFilesystem: true
      allowPrivilegeEscalation: false
      capabilities: { drop: ["ALL"] }
```

- **sign และ verify ที่ digest ไม่ใช่ที่ tag** `cosign sign "$IMAGE"` ใน CI job จะ sign แบบ keyless ด้วย OIDC identity ของ job ส่วน `cosign verify "$IMAGE" --certificate-identity=… --certificate-oidc-issuer=…` เช็กผู้ sign ก่อน deploy และ admission controller อย่าง Policy Controller ของ Sigstore ก็บังคับใช้การเช็กแบบเดียวกันใน cluster ได้
- **build ให้ตรงกับ processor ที่ใช้รันจริง** `docker buildx build --platform linux/amd64,linux/arm64` วาง image สำหรับ x86 และสำหรับ Arm (เช่น AWS Graviton) ไว้หลัง tag เดียว
- **เก็บกวาด** lifecycle policy ของ ECR ลบ image ที่เก่าและที่ไม่มี tag ส่วนบน host ตัว `docker system prune` ลบข้อมูลที่ไม่ได้ใช้แล้ว
