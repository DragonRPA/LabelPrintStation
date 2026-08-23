# Zebra GK-420D PC 로컬 프린트 에이전트  (v1.1)

## 개요
Supabase `print_queue` 테이블을 실시간 구독하여, 모바일에서 IMEI 자산을 확정하면
Zebra GK-420D 프린터로 ZPL 바코드 라벨을 **자동으로** 출력합니다.

**라벨 규격**: 72mm × 40mm | **바코드**: Code39 | **DPI**: 203

---

## 1. 사전 요구사항

- **Node.js 18 이상** 설치 확인: `node --version`
  - 다운로드: https://nodejs.org/ko (LTS 버전)
- Zebra GK-420D 전원 ON + PC에 USB 또는 LAN 연결

---

## 2. 설치 (최초 1회)

```powershell
cd print-agent
npm install
```

---

## 3. 실행 및 프린터 선택

### 최초 실행 또는 프린터 미설정 시 → 자동으로 대화형 설정 시작
```powershell
node zebra-agent.mjs
```

실행하면 PC에 설치된 **모든 프린터 목록**이 표시됩니다:

```
  === 연결된 프린터 목록 ===
  [1] ZDesigner GK420d
       포트: IP_192.168.1.50  ->  LAN 192.168.1.50
  [2] Apeos C2060
       포트: WSD-xxxx         ->  USB/로컬
  [3] IP 주소 직접 입력 (LAN 프린터)
  ========================

  프린터 번호 선택 [1-3]:
```

번호를 입력하면 TCP 호스트/포트를 자동으로 구성하고 `agent-config.json`에 저장합니다.

### 이후 실행 → 저장된 설정으로 즉시 시작 (5초 타임아웃)
```
  === 저장된 프린터 설정 ===
  프린터  : ZDesigner GK420d
  연결    : NETWORK
  주소    : 192.168.1.50:9100
  설정일시: 2026-08-14 14:05:00

  [Enter] 즉시 시작  /  [R+Enter] 프린터 재설정:
```
→ Enter 누르거나 5초 대기하면 자동으로 이전 설정으로 시작

### 프린터 변경 시 → --setup 플래그
```powershell
node zebra-agent.mjs --setup
```

---

## 1. 사전 요구사항

- **Node.js 18 이상** 설치 확인: `node --version`
  - 다운로드: https://nodejs.org/ko (LTS 버전)
- Zebra GK-420D 전원 ON + PC에 USB 또는 LAN 연결

---

## 2. 설치 (최초 1회)

```powershell
# 이 폴더(print-agent)에서 실행
cd print-agent
npm install
```

---

## 3. 실행

### 기본 실행 (USB 연결, 127.0.0.1:9100)
```powershell
node zebra-agent.mjs
```

### LAN 연결 프린터 (IP 직접 지정)
```powershell
$env:PRINTER_HOST="192.168.1.50"; node zebra-agent.mjs
```

### 파일 변경 시 자동 재시작 (개발 모드)
```powershell
npm run start:dev
```

---

## 4. Windows 시작프로그램 등록 (상주 실행)

`start-agent.bat` 파일을 아래 내용으로 만들고,
Windows 시작프로그램 폴더(`shell:startup`)에 넣으세요.

```batch
@echo off
cd /d "D:\GoogleDrive\RPA_dev\01.AntiGravity\LabelPrintStation\print-agent"
node zebra-agent.mjs >> agent.log 2>&1
```

---

## 5. 프린터 상태 확인

에이전트 실행 시 자동으로 TCP:9100 연결을 점검합니다.
```
✅ 프린터 연결 확인 (127.0.0.1:9100)
```
위 메시지가 나오면 정상입니다.

---

## 6. Supabase print_queue 테이블 상태값

| 상태 | 의미 |
|------|------|
| `PENDING` | 모바일 확정, 에이전트 미처리 |
| `PRINTING` | 에이전트가 처리 중 (선점) |
| `PRINTED` | ZPL 전송 완료, 라벨 출력됨 |
| `ERROR` | 전송 실패 (print_error 컬럼에 원인) |

---

## 7. ZPL 라벨 레이아웃 (72mm × 40mm)

```
┌──────────────────────────────────────┐
│ [관리번호]                           │
├──────────────────────────────────────┤
│ IMEI: 351379300225052                │
│ S/N : R5KL60F0CZW                   │
│ MAC : 4CEBB0B57A51                   │
│                                      │
│ ████████ [CODE39 BARCODE] ████████   │
│ [관리번호]                           │
└──────────────────────────────────────┘
```
