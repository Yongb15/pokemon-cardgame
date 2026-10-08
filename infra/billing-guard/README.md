# billing-guard (결제 자동 차단)

무료 범위를 넘는 비용이 생기면 프로젝트의 결제 연결을 끊어 모든 유료 서비스를 멈춥니다.

- 예산 `card-dex-guard`: ₩7,000, 크레딧 제외 실제 비용 기준, 20%·50%·100%에서 메일 알림
- 예산이 하루 여러 번 현재 비용을 Pub/Sub `billing-alerts`로 보냄 → 이 함수가 **₩1,000 이상**이면 결제 연결 해제
- 예산 집계는 몇 시간 늦을 수 있어, 차단 전에 약간의 비용이 생길 수 있음
- 다시 켜려면 콘솔 → 결제 → 프로젝트에 결제 계정을 직접 다시 연결 (해제되면 Cloud Run 등이 멈춤)

## 권한 (최소)

- 서비스 계정 `billing-guard@`: 전용 역할 `billingGuard`
  (`resourcemanager.projects.get`, `resourcemanager.projects.deleteBillingAssignment`)만 가짐
- 이 함수 자신에 대한 `run.invoker` (Pub/Sub 트리거용), 수신은 `internal`만 허용

## 배포

```sh
gcloud functions deploy billing-guard --gen2 --region=us-central1 --runtime=nodejs22 \
  --source=infra/billing-guard --entry-point=guard --trigger-topic=billing-alerts \
  --service-account=billing-guard@pokemon-card-dex-511008.iam.gserviceaccount.com \
  --set-env-vars=PROJECT_ID=pokemon-card-dex-511008,LIMIT=1000 \
  --max-instances=1 --memory=256Mi --timeout=60s --ingress-settings=internal-only \
  --no-allow-unauthenticated
```

## 점검 (결제를 끊지 않음)

```sh
gcloud pubsub topics publish billing-alerts --message='{"check":true}'
# 로그에 "check: billingEnabled=true, limit=1000"이 찍히면 정상
```
