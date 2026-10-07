## ปัญหา

service Catalog ของ Acme Shop ส่งออกไปเป็น container image `catalog:1.4.2` และ Orders, Cart กับ service อื่น ๆ ก็เป็นแบบเดียวกัน ต้องมีใครสักคนตัดสินว่าแต่ละ copy จะรันบนเครื่องไหน แล้วยังต้อง restart copy ที่ crash เริ่มตัวใหม่ที่อื่นเมื่อเครื่องตาย เพิ่ม copy ตอนพีคช่วงเย็นแล้วเอาออกทีหลัง ให้ load balancer ชี้ไปแค่ copy ที่พร้อมแล้ว และเปลี่ยนทุก copy เป็น 1.4.3 โดยไม่ทำ request หลุด ถ้าทำด้วย script และ runbook แต่ละเรื่องก็คือขั้นตอนแยกกันที่ต้องมีคนรันให้ถูกจังหวะ ทุก service แล้วในคืนที่แย่ ๆ ก็จะมีสักเรื่องที่ถูกลืม

Kubernetes รวมทั้งหมดนั้นเป็นโมเดลเดียว เราประกาศ state ที่ต้องการ (image นี้ 3 replica เข้าถึงได้ด้วยชื่อนี้ และมีได้ตั้งแต่ 3 ถึง 6 ตัวตาม CPU) แล้วชุดของ controller ก็คอยเทียบสิ่งที่ประกาศไว้กับสิ่งที่รันอยู่จริง และซ่อมส่วนที่ต่างกัน ไม่ว่าอะไรจะเป็นต้นเหตุ

## ทำงานยังไง

### Control plane และ node

cluster หนึ่งมี **control plane** ที่เก็บ desired state และเป็นฝ่ายตัดสินใจ กับ **worker node** ที่รัน container

- **kube-apiserver** ให้บริการ Kubernetes API ทุกอย่างวิ่งผ่านมัน: `kubectl`, เครื่องมือ GitOps, component อื่นของ control plane และทุก node มันยืนยันตัวตนและตรวจสิทธิ์ของแต่ละ request รัน admission check แล้ว validate object และเก็บมันไว้
- **etcd** คือ key-value store แบบ consistent และ highly available ที่อยู่หลัง API server และเก็บทุก object ใน cluster การเข้าถึง etcd ได้ตรง ๆ ก็เท่ากับคุม cluster ได้ทั้งหมด เอกสารเลยแนะนำให้มีแค่ API server ที่เข้าถึงมันได้ ให้รันมันเป็น cluster ที่มีจำนวนสมาชิกเป็นเลขคี่ โดยใน production แนะนำ 5 ตัว
- **kube-scheduler** คอยดู pod ที่ยังไม่มี node แล้วกำหนด node ให้แต่ละตัว
- **kube-controller-manager** รัน controller ที่ติดมาในตัว แต่ละตัวเป็น loop แยกกัน อยู่ใน process เดียว: Deployment, ReplicaSet, node lifecycle, HorizontalPodAutoscaler, EndpointSlice, Job และอีกเยอะ
- **cloud-controller-manager** (มีเฉพาะบน cloud) รัน loop ที่คุยกับ provider: มันลบ node ที่ virtual machine หายไปแล้ว ตั้ง route และสร้าง load balancer ของ cloud ให้ Service แบบ `LoadBalancer`

ทุก node รัน:

- **kubelet** คือ agent ที่ watch API server หา pod ที่ผูกกับ node ของมัน สั่งเริ่ม container ของ pod เหล่านั้น รัน probe และรายงานสถานะ
- **container runtime** อย่าง containerd หรือ CRI-O ที่ kubelet ขับผ่าน Container Runtime Interface (CRI) ส่วน integration กับ Docker Engine ที่ติดมาในตัว (dockershim) ถูกเอาออกใน Kubernetes 1.24 แต่ image ที่ build ด้วย [Docker](../docker/) ก็ยังใช้ได้ เพราะ containerd และ CRI-O รัน image ชุดเดียวกัน
- **kube-proxy** ตั้งค่าการส่งต่อ packet ของแต่ละ node ให้ address ของ Service ไปถึง pod ของ Service นั้น ตัวนี้จะมีหรือไม่มีก็ได้: network plugin บางตัวทำงานนี้เอง

ใน production ตัว control plane ถูก replicate ไว้ ส่วน scheduler และ controller manager รันหลาย copy แต่ active ทีละตัว โดยเลือกด้วย [leader election](../leader-election/) บน Lease object (`--leader-elect` เปิดไว้เป็นค่าตั้งต้น)

### สิ่งที่เราประกาศ

object คือบันทึกของสิ่งที่เราตั้งใจ ตัวที่ service อย่าง Catalog ใช้มีดังนี้:

| Object | สิ่งที่มันประกาศ |
|---|---|
| **Pod** | container หนึ่งตัวหรือมากกว่าที่ถูก schedule ไปด้วยกัน ใช้ network address และ volume ร่วมกัน เป็นหน่วยที่เล็กที่สุดที่ Kubernetes รัน |
| **Deployment**, **ReplicaSet** | pod N ตัวที่สลับกันได้ จาก template เดียว โดย Deployment เก็บ ReplicaSet หนึ่งตัวต่อ template หนึ่งเวอร์ชัน และนี่แหละที่ทำให้ rolling update กับ rollback ทำได้ |
| **StatefulSet** | pod ที่มีชื่อคงที่และมี persistent volume ของตัวเองคนละอัน สร้างตามลำดับ ใช้กับ database และ broker |
| **DaemonSet** | pod หนึ่งตัวบนทุก node หรือบน node ชุดที่เลือก: ตัวส่ง log, monitoring ของ node, network plugin |
| **Job**, **CronJob** | pod ที่รันจนจบ ครั้งเดียวหรือตามตารางเวลา |
| **Service** | ชื่อและ virtual IP ที่คงที่ อยู่หน้า pod ที่ตรงกับ label selector |
| **Ingress**, **Gateway API** | HTTP routing จากนอก cluster เข้าไปที่ Service |
| **ConfigMap**, **Secret** | config และ credential ที่ mount เป็นไฟล์หรือส่งเป็น environment variable |
| **Namespace** | ขอบเขตของชื่อ กฎการเข้าถึง และ quota มักมีหนึ่งตัวต่อทีมหรือต่อ environment |

### Desired state และ reconciliation

`kubectl apply -f catalog.yaml` ส่ง object ไปที่ API server แล้ว API server ก็เก็บมันไว้ใน etcd ถึงตรงนี้ยังไม่มีอะไรรัน: cluster แค่บันทึกว่าอะไรควรมีอยู่ จากนั้นแต่ละ component ก็ทำงานเล็ก ๆ ของตัวเองวนเป็น loop มัน watch API server หา object ที่ตัวเองรับผิดชอบ เทียบสิ่งที่ object ขอกับสิ่งที่มีอยู่ แล้วลงมือเปลี่ยน โดยผ่าน API server อีกเช่นกัน นี่คือลำดับของ step 2:

1. **Deployment controller** เจอว่า `catalog` ยังไม่มี ReplicaSet สำหรับ pod template ของมัน ก็เลยสร้างขึ้นมาหนึ่งตัว ชื่อของมันลงท้ายด้วย hash ของ template และ hash นี้ก็เก็บไว้ใน label `pod-template-hash` ด้วย
2. **ReplicaSet controller** นับได้ 0 จาก 3 pod ก็เลยสร้าง Pod object 3 ตัว พวกมันอยู่ในสถานะ *Pending*: ยังไม่มีใครเลือก node ให้
3. **scheduler** กรอง node ที่รับ pod แต่ละตัวได้ก่อน: เหลือ CPU และ memory พอหลังนับ request ของ pod ที่อยู่บน node นั้นแล้ว node selector กับ affinity ตรงกัน และมีแค่ taint ที่ pod tolerate ได้ จากนั้นมันก็ให้คะแนน node ที่เหลือ เลือกตัวที่ดีที่สุด แล้วบันทึกตัวที่เลือกผ่าน *binding*
4. **kubelet** บน node นั้นเห็น pod ที่ผูกกับตัวเอง ก็ให้ runtime pull image และเริ่ม container แล้วรัน probe พอ readiness probe ผ่าน pod ก็ *Ready* แล้ว EndpointSlice controller ก็เพิ่ม address ของมันเข้าไปใน Service `catalog`

controller, scheduler และ kubelet ไม่ได้เรียกหากันตรง ๆ พวกมันประสานงานกันผ่าน object ใน API server เท่านั้น พอมีอะไรคลาดไป (pod ถูกลบ node หายไป หรือมีคนแก้ `replicas`) loop ชุดเดิมก็จะเห็นส่วนที่ต่างแล้วซ่อมมัน และเพราะ state อยู่ใน etcd ตัว controller ที่ restart ก็แค่ทำงานต่อจาก state นั้น เอกสารของ Kubernetes เปรียบ controller เหมือนเทอร์โมสตัท ส่วน Burns และผู้เขียนร่วมอธิบายไว้ใน *Borg, Omega, and Kubernetes* (2016) ว่าดีไซน์นี้โตมาจาก cluster manager รุ่นก่อน ๆ ของ Google ยังไง

manifest ที่อยู่เบื้องหลัง animation ตัดให้สั้นลงนิดหน่อย:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: catalog
spec:
  replicas: 3                 # remove this line once the autoscaler below owns the count
  selector:
    matchLabels: {app: catalog}
  template:
    metadata:
      labels: {app: catalog}
    spec:
      containers:
      - name: catalog
        image: 111122223333.dkr.ecr.us-east-1.amazonaws.com/catalog:1.4.2
        ports:
        - containerPort: 8080
        resources:
          requests: {cpu: 250m, memory: 256Mi}
          limits: {memory: 256Mi}
        readinessProbe:
          httpGet: {path: /ready, port: 8080}
        livenessProbe:
          httpGet: {path: /healthz, port: 8080}
---
apiVersion: v1
kind: Service
metadata:
  name: catalog
spec:                         # type ClusterIP is the default
  selector: {app: catalog}
  ports:
  - port: 80
    targetPort: 8080
---
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: catalog
spec:
  scaleTargetRef: {apiVersion: apps/v1, kind: Deployment, name: catalog}
  minReplicas: 3
  maxReplicas: 6
  metrics:
  - type: Resource
    resource:
      name: cpu
      target: {type: Utilization, averageUtilization: 60}
```

### Request, limit และการวาง pod

- **request จอง capacity** scheduler จะวาง pod บน node ก็ต่อเมื่อทั้ง CPU และ memory ของ request ของ pod ที่อยู่แล้วบวกกับ request ของ pod ใหม่ ยังพอดีกับที่ node ให้ pod ได้ มันไม่ดูการใช้งานจริง: Catalog สาม pod จอง CPU 750m ไว้ไม่ว่าจะยุ่งหรือว่าง และ node ก็อาจปฏิเสธ pod ทั้งที่ CPU ว่างอยู่ บน node ที่ยุ่ง ตัว CPU ก็ถูกแบ่งตามสัดส่วนของ request ด้วย
- **limit คุมการใช้** kernel จะ throttle container ที่ใช้ CPU ถึง limit ส่วน container ที่ใช้ memory เกิน limit อาจโดน OOM killer ของ kernel kill (เหตุผลที่รายงานคือ `OOMKilled`) การ kill เกิดตอน kernel ตรวจเจอว่า memory ตึง ทำให้ container อาจรันเกิน limit ไปสักพักก่อนจะโดน kill
- **eviction ปกป้อง node** พอ node เริ่มขาด memory (บน Linux ค่าตั้งต้นคือเมื่อเหลือน้อยกว่า 100Mi) ตัว kubelet ก็จะ evict pod โดยเริ่มจากตัวที่ใช้มากกว่าที่ request ไว้
- **กฎการวาง pod**: node selector และ node affinity ดึง pod ไปหา node ส่วน pod affinity และ anti-affinity วาง pod ให้อยู่ใกล้หรือห่างจากกัน แล้ว topology spread constraint ก็กระจาย replica ไปตาม zone หรือ node ส่วน taint กัน pod ออกจาก node เว้นแต่ pod จะมี toleration ที่ตรงกัน เช่นบน node ที่มี GPU

### Service, Gateway API และ kube-proxy

ทุก pod ได้ IP address ของตัวเอง ที่ไม่ซ้ำกันทั้ง cluster โดยมี network plugin ที่ implement Container Network Interface (CNI) เป็นตัวต่อสายให้ ส่วน pod ก็เกิดและหายไปตลอด ทำให้ client ใช้ **Service**: virtual IP และชื่อ DNS ที่คงที่ อยู่หน้า pod ที่ตรงกับ selector ของมัน type ตั้งต้นคือ `ClusterIP` เข้าถึงได้แค่ภายใน cluster ส่วน `NodePort` และ `LoadBalancer` เปิด Service ออกไปนอก cluster

pod ที่อยู่หลัง Service ถูก list ไว้ใน **EndpointSlice** แต่ละตัวมี condition ของมัน และ traffic จะไปแค่ endpoint ที่ ready พอ readiness probe fail ตัว endpoint ของ pod จะถูก mark ว่าไม่ ready และ pod ก็ไม่ได้ request ใหม่ แต่มันยังรันต่อไป ส่วน kube-proxy แปลง EndpointSlice เป็น forwarding rule บนทุก node และเลือก backend แบบสุ่มเป็นค่าตั้งต้น โหมดของมันบน Linux ณ Kubernetes 1.37 คือ:

- `iptables` ตัวตั้งต้น
- `nftables` ตัวที่มาแทน (ต้องใช้ Linux kernel 5.13 ขึ้นไป) release ในอนาคตจะตั้งมันเป็นค่าตั้งต้น เพราะฉะนั้นให้ตั้งโหมดไว้ชัด ๆ
- `ipvs` deprecate ตั้งแต่ 1.35 จะถูกปิดเป็นค่าตั้งต้นตั้งแต่ 1.40 และถูกเอาออกใน 1.43

จากข้างนอก HTTP traffic เข้าถึง Service ผ่าน Ingress หรือ Gateway ตัว **Ingress API** เป็น generally available แต่ถูก freeze แล้ว: มันจะไม่ถูกเอาออกและจะไม่เปลี่ยนอีก และโปรเจกต์ Kubernetes แนะนำให้ใช้ **Gateway API** แทน ตัว Gateway API เป็น add-on คือชุดของ custom resource ที่แบ่งงานตามบทบาท: GatewayClass ระบุ controller ที่ implement gateway ส่วน Gateway คือทางเข้าหนึ่งจุด (มักเป็น load balancer ของ cloud) ที่ทีม platform เป็นเจ้าของ แล้ว object HTTPRoute หรือ GRPCRoute ที่ทีมแอปเป็นเจ้าของก็ส่ง request ไปที่ Service ใน animation ตัว HTTPRoute ส่ง `/products` ไปที่ `catalog` ส่วน Gateway API ถึง v1.0 (GA) ในเดือนตุลาคม 2023 แล้ว v1.6.0 ก็ออกเดือนมิถุนายน 2026 ส่วน controller Ingress [NGINX](../nginx/) ที่ใช้กันแพร่หลายถูกปลดระวางในเดือนมีนาคม 2026 และ repository ของมันก็ถูก archive แล้ว ทำให้ cluster ที่ยังใช้มันอยู่ควรย้ายไป Gateway API หรือ controller ตัวอื่น

**NetworkPolicy** จำกัดว่า pod ไหนคุยกับ pod ไหนได้ แต่ก็ต่อเมื่อ network plugin บังคับใช้มันเท่านั้น ถ้าไม่มี plugin แบบนั้น object นี้ก็ไม่มีผลอะไร

### Health check และการซ่อมตัวเอง

kubelet รัน probe สามแบบกับแต่ละ container:

- **liveness**: ถ้า fail ตัว kubelet จะ restart container
- **readiness**: ถ้า fail ตัว pod จะออกจาก endpoint ของ Service จนกว่าจะผ่านอีกครั้ง
- **startup**: กันอีกสองตัวไว้ก่อน จนกว่า container ที่เริ่มช้าจะพร้อม

ค่าตั้งต้นคือ probe รันทุก 10 s, timeout หลัง 1 s และนับว่า fail หลังพลาดติดกัน 3 ครั้ง

**node** ที่พังจะถูกตรวจเจอโดย control plane เพราะตัว node เองรายงานอะไรไม่ได้แล้ว ตัว kubelet แต่ละตัวส่ง heartbeat ด้วยการต่ออายุ Lease object และอัปเดตสถานะของ node ตัวเอง step 3 ใช้ค่าตั้งต้นตามนี้:

1. พอไม่มี heartbeat ครบ 50 s (`--node-monitor-grace-period`) ตัว node controller ก็ตั้ง condition `Ready` ของ node-2 เป็น `Unknown` (`kubectl get nodes` แสดง `NotReady`) ใส่ taint `node.kubernetes.io/unreachable` ให้ node และ mark pod ของมันว่าไม่ ready endpoint ของ pod เหล่านั้นก็ถูก mark ว่าไม่ ready ด้วย ทำให้ Service หยุดส่ง traffic ไปให้
2. ถ้า workload ไม่ได้ตั้งเอง pod ของมันจะ tolerate taint นั้นได้ 300 s ผ่าน toleration ที่ Kubernetes เติมให้อัตโนมัติ พอหมดเวลา pod ก็ถูก evict
3. ReplicaSet ไม่นับ pod ที่ถูก evict แล้ว ก็เลยสร้างตัวใหม่มาแทน แล้ว scheduler ก็วางมันบน node ที่ปกติ ในที่นี้คือ node-3

สรุปคือ pod แบบ stateless บน node ที่ตายจะถูกแทนที่หลังผ่านไปประมาณหกนาที ส่วน traffic ของมันหยุดภายในราวหนึ่งนาที ตั้ง `tolerationSeconds` ที่ workload ถ้าอยากให้รอสั้นลงหรือนานขึ้น ส่วน kubelet บน node ที่โดนตัดขาดจะไม่รู้เรื่อง eviction เลย ทำให้ pod ตัวเก่าอาจรันต่อไปบนนั้นจนกว่า node จะต่อกลับมา สำหรับ Catalog ไม่เป็นปัญหา แต่สำหรับ database เป็น และนี่คือเหตุผลที่ StatefulSet จะไม่เริ่ม pod ตัวแทนจนกว่าจะยืนยันได้ว่า pod ตัวเก่าหายไปแล้ว: เมื่อ node ถูกลบ เมื่อ kubelet ของมันรายงานกลับมา หรือเมื่อมีคน force-delete pod นั้น

การหยุดที่วางแผนไว้ เช่นการ drain node เพื่อ upgrade จะผ่าน eviction API แทน และ **PodDisruptionBudget** ก็จำกัดว่า pod ของ workload หนึ่งจะ down พร้อมกันได้กี่ตัวในช่วงนั้น

### Scale pod และ node

**HorizontalPodAutoscaler** เช็ก metric ทุก 15 s และคำนวณ

```
desiredReplicas = ceil(currentReplicas × currentMetricValue / desiredMetricValue)
```

สำหรับ CPU ค่านี้คือ utilization เฉลี่ยเป็นเปอร์เซ็นต์ของ **request** ของ pod ถ้า pod ไม่มี CPU request ตัว autoscaler ก็ไม่มีอะไรให้คำนวณ ใน step 3 pod สามตัวใช้เฉลี่ย 90% ของ request 250m (ตัวละ 225m) เทียบกับ target 60% ทำให้ HPA ขอ ceil(3 × 90 / 60) = 5 replica โดยยังอยู่ในช่วง 3 ถึง 6 ของมัน ถ้าโหลดเท่าเดิม pod ห้าตัวจะเฉลี่ย 54% ส่วนถ้าอยู่ที่ 40% มันจะขอ ceil(3 × 40 / 60) = 2 แต่ `minReplicas` ก็คงไว้ที่ 3 ส่วน autoscaler จะไม่สนอัตราส่วนที่อยู่ในช่วง 10% รอบ 1.0 (tolerance ตั้งต้น ที่ HPA แต่ละตัว override ได้ และ stable ตั้งแต่ 1.37) ค่าตั้งต้นคือมันเพิ่ม replica ได้สองเท่าหรือเพิ่ม 4 ตัว แล้วแต่อย่างไหนมากกว่า ทุก 15 s และ scale ลงแค่ถึงค่าแนะนำที่สูงที่สุดใน 5 นาทีล่าสุด ทำให้ช่วงโหลดตกสั้น ๆ ไม่ทำให้ pod หายไป resource metric มาจาก metrics API ที่ปกติให้บริการโดย metrics-server ส่วนตั้งแต่ 1.37 (beta เปิดเป็นค่าตั้งต้น) HPA ที่ scale ตาม object metric หรือ external metric เช่นความยาวของ queue ตั้ง `minReplicas: 0` ได้ แต่การ scale ลงถึงศูนย์ตาม CPU หรือ memory ยังไม่รองรับ

**Vertical Pod Autoscaler** เป็น add-on จากโปรเจกต์ autoscaler ของ Kubernetes มันตั้ง request จากการใช้งานที่สังเกตได้ โหมด `InPlaceOrRecreate` ของมัน (GA ใน VPA 1.6) ปรับค่าให้ pod ที่รันอยู่แบบ in place ถ้าทำได้ (in-place resize เป็น stable ตั้งแต่ Kubernetes 1.35) ถ้าไม่ได้ก็สร้าง pod ใหม่ เอกสารของมันเตือนว่าอย่าใช้คู่กับ HPA บน CPU หรือ memory metric ตัวเดียวกัน

pod ที่ไม่มี node ไหนรับได้จะค้างอยู่ที่ Pending แล้ว **node autoscaler** ก็จะเพิ่ม node ให้ และเอา node ที่ไม่จำเป็นแล้วออก SIG Autoscaling ดูแลอยู่สองตัว: **Cluster Autoscaler** ที่ขยายและหด node group ที่กำหนดไว้ล่วงหน้า และ **Karpenter** ที่เปิด instance ทีละตัวให้พอดีกับ pod ที่ pending ตามกฎใน NodePool และยังเปลี่ยน node ใหม่เมื่อมันเก่าหรือมี image ใหม่ออกมาด้วย

### Rolling update

เปลี่ยน image เป็น `catalog:1.4.3` แล้ว Deployment ก็จะสร้าง ReplicaSet ใหม่และค่อย ๆ ย้าย pod ไป มีสอง setting ที่คุมการย้าย ค่าตั้งต้นเป็น 25% ทั้งคู่: `maxSurge` คือจำนวน pod ส่วนเกินที่ยอมให้มีได้ ปัดขึ้น ส่วน `maxUnavailable` คือจำนวน pod ที่ยอมให้ขาดได้ ปัดลง ถ้ามี 3 replica ก็คือเกินได้ 1 และขาดได้ 0: pod ใหม่หนึ่งตัวเริ่ม แล้วตัวเก่าจะไปก็ต่อเมื่อตัวใหม่ ready แล้ว ส่วนถ้ามี 5 replica ก็คือ 2 กับ 1 ส่วน rollout ที่ไม่คืบหน้าเลยตลอด `progressDeadlineSeconds` (ค่าตั้งต้น 600 s) จะถูกรายงานว่า fail และ Kubernetes จะไม่ทำอะไรต่อ: ต้อง rollback เองด้วย `kubectl rollout undo deployment/catalog` ดู [rolling update](../rolling-update/) ส่วน [canary release](../canary-release/) และ [blue-green deployment](../blue-green-deployment/) ต้องใช้มากกว่านั้น เช่น weighted backend ใน HTTPRoute หรือ progressive-delivery controller

### Storage

pod ขอ storage แบบถาวรผ่าน **PersistentVolumeClaim** แล้ว **StorageClass** ก็ provision **PersistentVolume** ที่ตรงกันให้ตามต้องการ ผ่าน storage driver ที่ implement Container Storage Interface (CSI) ตอนนี้ volume type ของ cloud แบบ in-tree อย่าง `gcePersistentDisk` ส่งทุก operation ต่อให้ CSI driver ที่คู่กัน ตัว StatefulSet ให้ pod แต่ละตัวของมันมี claim ของตัวเอง ส่วน volume อย่าง Amazon EBS อยู่ใน Availability Zone เดียว ทำให้ pod ที่ใช้มัน schedule ได้แค่ใน zone นั้น

### Security

- **การเข้าถึง API**: ทุก request ถูกยืนยันตัวตนแล้วตรวจสิทธิ์ ปกติด้วย RBAC ที่มี object สี่แบบ: Role และ ClusterRole บอกว่าทำอะไรได้ ส่วน RoleBinding และ ClusterRoleBinding บอกว่าให้ใคร ตัว pod เรียก API ในนาม ServiceAccount เพราะฉะนั้นให้แต่ละ workload มีของตัวเอง และ bind แค่สิ่งที่มันต้องใช้
- **Pod Security Standards** กำหนดไว้สามระดับ คือ `privileged`, `baseline` และ `restricted` แล้ว Pod Security admission controller ที่ติดมาในตัว (stable ตั้งแต่ 1.25) ก็บังคับใช้หนึ่งระดับต่อ namespace ผ่าน label
- **NetworkPolicy**: ถ้าไม่มี policy เลย ทุก pod เข้าถึงทุก pod ได้ ให้เพิ่ม policy แบบ default-deny ต่อ namespace แล้วเปิดเฉพาะที่จำเป็น
- **Secret** แค่ encode ด้วย base64 และค่าตั้งต้นคือเก็บใน etcd แบบไม่เข้ารหัส ให้เปิด encryption at rest โดยควรใช้ KMS v2 provider (stable ตั้งแต่ 1.29) ใช้ RBAC จำกัดว่าใครอ่าน Secret ได้ หรือเก็บ credential ไว้ใน secrets manager ภายนอก

### เวอร์ชัน การ support และขนาด (ตุลาคม 2026)

minor release ปัจจุบันคือ **1.37** ออกวันที่ 26 สิงหาคม 2026 (patch ล่าสุด 1.37.1 วันที่ 15 กันยายน 2026) Kubernetes ออก minor release ประมาณปีละสามครั้ง และดูแลสามตัวล่าสุด (1.37, 1.36 และ 1.35) แต่ละตัวได้ patch ราว 14 เดือน แบ่งเป็น standard support 12 เดือนและ maintenance mode 2 เดือน ทำให้ 1.37 หมดอายุวันที่ 28 ตุลาคม 2027 การ upgrade ย้าย API server ทีละ minor version ก่อน แล้วค่อย component อื่นของ control plane แล้วค่อย node ตัว kubelet เก่ากว่า API server ได้ไม่เกินสาม minor version และห้ามใหม่กว่า ส่วน `kubectl` ควรห่างจากมันไม่เกินหนึ่ง minor version แล้ว Kubernetes 1.37 ก็รองรับ cluster ได้ถึง 5,000 node, 110 pod ต่อ node, 150,000 pod และ 300,000 container

## อยู่ตรงไหนใน solution

- **Solution** platform ที่อยู่ใต้ [microservices](../microservices/) แบบของ Acme Shop, internal developer platform ที่ให้ทีมต่าง ๆ deploy ได้เองแบบ self-service, งาน batch, data และ machine learning ที่รันข้าง ๆ service ที่รันยาว และ setup แบบ hybrid หรือ multi-cloud ที่อยากได้ API เดียวกันบน Amazon EKS, Azure AKS, Google GKE และ hardware ของตัวเอง
- **Pattern ที่มัน implement หรือช่วยรองรับ** [Rolling update](../rolling-update/) ที่ติดมาใน Deployment, [autoscaling](../autoscaling/) ของ pod และ node, [health endpoint monitoring](../health-endpoint-monitoring/) ผ่าน probe, [sidecar](../sidecar/) ที่รองรับในตัวตั้งแต่ sidecar container เป็น stable ใน 1.33 และ [ambassador](../ambassador/) ที่สร้างบน sidecar, [service mesh](../service-mesh/) บน cluster, [GitOps](../gitops/) ที่ Argo CD หรือ Flux apply manifest จาก Git ด้วยแนวคิด reconcile loop แบบเดียวกัน, [leader election](../leader-election/) บน Lease object ทั้งสำหรับ control plane และ controller ที่เราเขียนเอง, [external configuration](../external-configuration-store/) ผ่าน ConfigMap และ Secret, [bulkhead](../bulkhead/) ผ่าน namespace, quota, request และ limit, [immutable infrastructure](../immutable-infrastructure/) เพราะ pod ถูกแทนที่แทนการ patch และ release แบบ [canary](../canary-release/) และ [blue-green](../blue-green-deployment/) โดยอาศัย Gateway API หรือ progressive-delivery controller
- **เพื่อนบ้านที่มักเจอ** CI pipeline ที่ build image กับ registry อย่าง Amazon ECR, GitOps controller, load balancer ของ cloud, DNS และ [API gateway](../api-gateway/) อยู่ด้านหน้า, [centralized logging](../centralized-logging/), metric และ [distributed tracing](../distributed-tracing/) อยู่รอบ ๆ, secrets manager และ managed database นอก cluster สำหรับข้อมูลที่มี state ส่วนใหญ่ เช่น [PostgreSQL](../postgresql/) บน Amazon RDS
- **Managed offering (ตุลาคม 2026)** **Amazon EKS** รัน control plane ให้ในราคา $0.10 ต่อ cluster ต่อชั่วโมง ระหว่างที่เวอร์ชันนั้นอยู่ใน standard support (14 เดือนหลัง EKS ออกเวอร์ชันนั้น) และ $0.60 ใน extended support อีก 12 เดือนถัดมา ที่เปิดไว้เป็นค่าตั้งต้น EKS รองรับ Kubernetes 1.31 ถึง 1.37 โดย 1.37 มาถึง EKS วันที่ 1 ตุลาคม 2026 และ standard support ของมันจบวันที่ 1 ธันวาคม 2027 **EKS Auto Mode** ขยายการดูแลของ AWS ไปถึง node: มัน provision และ scale node ด้วย Karpenter, patch และ upgrade node และจัดการ load balancing, pod networking, cluster DNS และ block storage โดยคิดค่าบริการเพิ่มบน EC2 instance แต่ละตัวที่มันดูแล นอกจากนี้ EKS ยังมี Provisioned Control Plane tier ที่จอง capacity ของ control plane ไว้ให้ workload หนัก ๆ, AWS Fargate ที่รันแต่ละ pod บน compute ที่แยกของตัวเองโดยไม่มี node, Hybrid Nodes สำหรับเครื่อง on-premises และ EKS Capabilities ที่รัน Argo CD, AWS Controllers for Kubernetes และ kro เป็น managed service ส่วน **Azure AKS** มี AKS Automatic ที่ตั้งค่าไว้พร้อมใช้ใน production โดยเปิด node autoprovisioning, HPA, KEDA และ VPA ไว้ให้ และ **Google GKE** มี Autopilot ที่ Google แนะนำ: Google ดูแล node ให้ และคิดเงิน pod ส่วนใหญ่ตาม resource ที่ request
- **License และโปรเจกต์** Kubernetes เป็น open source ภายใต้ Apache License 2.0 มันเข้าร่วม Cloud Native Computing Foundation ในเดือนมีนาคม 2016 และ graduate ในเดือนมีนาคม 2018

## ใช้ตอนไหนดี

เลือก Kubernetes เมื่อรัน service จำนวนมาก หรือมีไม่กี่ตัวแต่ต้องคุมการ schedule, scale, networking หรือ storage อย่างละเอียด เมื่ออยากได้ API เดียวข้าม cloud และ data centre หรือเมื่ออยากใช้ ecosystem ของ operator, mesh, เครื่องมือ GitOps และ autoscaler ของมัน ถ้าไม่มีเหตุผลที่ต้องรัน control plane เอง ให้เริ่มจากแบบ managed ถ้ามีแค่ stateless HTTP service ไม่กี่ตัวบน AWS ตัว Amazon ECS เรียนรู้และดูแลง่ายกว่า สำหรับ service ที่ขับด้วย request และ scale ลงถึงศูนย์ได้ serverless container ตัด cluster ทิ้งไปได้เลย ส่วน HashiCorp Nomad เหมาะกับทีมที่ schedule workload ที่ไม่ใช่ container ด้วยและอยากได้ระบบที่เล็กกว่า

| | Kubernetes | Amazon ECS | HashiCorp Nomad | Serverless container (AWS Fargate, Google Cloud Run) |
|---|---|---|---|---|
| มันคืออะไร | orchestrator แบบ open source ที่มี API ขยายได้: custom resource และ controller | orchestrator ของ AWS เอง ตั้งค่าผ่าน AWS API | scheduler ใน binary เดียว สำหรับ container, virtual machine และโปรแกรมธรรมดา | container รันบน compute ของ provider โดย Fargate อยู่ใต้ ECS หรือ EKS ส่วน Cloud Run เป็น platform ทั้งตัว |
| Control plane | เรารันเอง หรือแบบ managed: EKS, AKS, GKE | AWS โดยไม่คิดค่า orchestration | เรารัน Nomad server เอง | provider |
| Node | ของเราเอง หรือแบบ managed: EKS Auto Mode, GKE Autopilot, AKS Automatic | EC2 instance ที่เราดูแลเอง, ECS Managed Instances หรือ Fargate | ของเราเอง | ไม่มีให้ดูแล บน EKS Fargate แต่ละ pod ได้ kernel ของตัวเอง และใช้ DaemonSet กับ GPU ไม่ได้ |
| Scaling | HPA, VPA, Cluster Autoscaler หรือ Karpenter | Service auto scaling และ capacity provider | Nomad Autoscaler ที่แยกออกมา | Fargate: ใช้การ scale ของ orchestrator ส่วน Cloud Run: ตาม request ลงได้ถึงศูนย์ |
| License และค่าใช้จ่าย | Apache 2.0 ส่วน EKS คิด $0.10 ต่อ cluster ต่อชั่วโมง บวกค่า node | ไม่มีค่า ECS จ่ายแค่ EC2, Fargate หรือค่า Managed Instances | Business Source License 1.1 ตั้งแต่ 1.7.0 (แต่ละเวอร์ชันกลายเป็น MPL 2.0 หลังสี่ปี) | จ่ายตาม vCPU และ memory ที่ request (Fargate) หรือต่อ request หรือต่อ instance (Cloud Run) |
| เหมาะกับ | service จำนวนมาก, การย้ายข้าม platform, การคุมละเอียด | ทีมที่ใช้แค่ AWS และอยากดูแลของน้อยลง | workload ผสม, ทีม operations ขนาดเล็ก | service ที่โหลดกระชากหรือเล็ก, ทีมที่ไม่อยากรัน node |

ตัวเลขจากเอกสารของ Kubernetes 1.37, Amazon EKS, Amazon ECS, AWS Fargate, Google Cloud Run และ HashiCorp Nomad เดือนตุลาคม 2026

## ได้อะไร เสียอะไร

- **เป็นระบบที่ต้องรันในตัวมันเอง** control plane, network plugin, CoreDNS, gateway controller, metrics-server, autoscaler และ CSI driver ต้องติดตั้ง เฝ้าดู และ upgrade กันหมด อย่างน้อยปีละครั้ง ให้อยู่ในช่วงราว 14 เดือนที่แต่ละ minor release ได้ patch ส่วนบริการแบบ managed รับ control plane และบางทีก็ node ไปดูแล แต่ไม่ได้รับเรื่องดีไซน์ไปด้วย: request, probe, network policy และการ test ก่อน upgrade ยังเป็นงานของเรา
- **ต้องเรียนรู้เยอะ** service เล็ก ๆ ตัวเดียวก็ต้องมี Deployment, Service, route, autoscaler, disruption budget และกฎการเข้าถึงแล้ว บวกเครื่องมือทำ template ให้มันอีก (Helm, Kustomize) แนวคิดพวกนี้คุ้มเมื่อมี service เยอะ แต่ถ้ามีแค่สองสามตัว ส่วนใหญ่ก็เป็นแค่ต้นทุน
- **ประสิทธิภาพขึ้นกับ request** pod ถูกอัดลง node ตามที่มัน request ถ้าตั้ง request สูงไป node จะถูกจองไว้แต่ว่าง ถ้าตั้งต่ำไป pod ก็แย่ง CPU กัน และตัวที่กิน memory เยอะจะโดน evict หรือ OOM-kill
- **ค่าตั้งต้นรับมือความพังได้ช้า** traffic ออกจาก pod บน node ที่ตายหลังผ่านไปราวหนึ่งนาที แต่ pod ถูกแทนที่หลังราวหกนาที และ pod แบบ stateful อาจต้องให้คนยืนยันว่า node หายไปแล้วจริง ๆ
- **ปลอดภัยก็ต่อเมื่อตั้งค่าแล้ว** แบบที่ติดตั้งมาเปล่า ๆ ทุก pod เข้าถึงทุก pod ได้ และ Secret ก็อยู่ใน etcd แบบไม่เข้ารหัส ส่วน network policy, Pod Security admission, การดูแล RBAC ให้เรียบร้อย และ encryption at rest ต้องเปิดเองทั้งหมด
- **Overhead** control plane แบบ managed บน EKS ที่ $0.10 ต่อชั่วโมงตกราว $73 ต่อเดือนต่อ cluster และทุก node ก็ต้องแบ่ง capacity บางส่วนให้ kubelet, runtime และ DaemonSet

## ข้อควรรู้ตอนลงมือทำ

- **กำหนด request จากค่าที่วัดได้** เริ่มจาก CPU และ memory ที่ใช้จริง (VPA แนะนำค่าให้ได้) ตั้ง memory limit ให้เท่ากับหรือสูงกว่าพีคจริง และตัดสินเรื่อง CPU limit อย่างตั้งใจ: limit จะ throttle container แม้ node จะมี CPU ว่างอยู่ก็ตาม
- **ให้ probe ตอบตามจริง** readiness ตอบว่า "ตอนนี้รับ traffic ได้ไหม" ส่วน liveness ตอบแค่ว่า "ค้างจนซ่อมไม่ได้แล้วหรือยัง" อย่าให้ liveness ขึ้นกับ database หรือ service อื่นเด็ดขาด ไม่งั้นแค่ outage ครั้งเดียวก็ทำให้ทุก pod restart ส่วนตัวที่เริ่มช้าให้ใส่ startup probe
- **ให้ autoscaler เป็นเจ้าของจำนวน replica** เอา `replicas` ออกจาก Deployment เมื่อ HPA มาดูแลแล้ว ตามที่เอกสารแนะนำ ไม่งั้นทุก `kubectl apply` จะรีเซ็ตจำนวนนั้น ส่วน setting เดียวกันนี้สั่งจาก command line ได้ด้วย `kubectl autoscale deployment catalog --min=3 --max=6 --cpu=60%`
- **รอดจากการเสีย node และ zone** รันอย่างน้อยสาม replica กระจายไปหลาย zone ด้วย topology spread constraint และปกป้องมันระหว่าง drain ด้วย PodDisruptionBudget
- **วางแผน upgrade ให้เป็นงานประจำ** อยู่ในเวอร์ชันที่ยังได้ patch อ่าน deprecation note ก่อน upgrade minor ทุกครั้ง ขยับทีละ minor version และ upgrade node หลัง control plane แล้วก็ตั้งโหมดของ kube-proxy ไว้ชัด ๆ เพราะค่าตั้งต้นในอนาคตจะเปลี่ยนมัน
- **ใช้ Gateway API สำหรับ routing ใหม่** และย้ายออกจาก Ingress NGINX ที่ไม่ได้ fix แล้ว
- **เริ่มแบบปลอดภัยไว้ก่อน** ServiceAccount หนึ่งตัวต่อ workload พร้อม RBAC แบบ least privilege ใช้ Pod Security ระดับ `restricted` ตรงที่ workload ยอมได้ มี NetworkPolicy แบบ default-deny ต่อ namespace เปิด encryption at rest ด้วย KMS v2 และให้ etcd เป็น private
- **เฝ้าดู loop** pod ที่ Pending, การ restart และเหตุผล `OOMKilled`, การตัดสินใจของ HPA (`kubectl describe hpa catalog`), condition ของ node และ event บอกได้ว่า loop ไหนกำลังมีปัญหา:

```sh
kubectl get nodes                                  # is any node NotReady?
kubectl get pods -l app=catalog -o wide            # which pod runs on which node, and is it ready?
kubectl describe hpa catalog                       # current and target CPU, and the last scaling events
kubectl rollout status deployment/catalog          # wait for a rollout to finish
kubectl rollout undo deployment/catalog            # go back to the previous ReplicaSet
```
