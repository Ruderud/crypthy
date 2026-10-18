// 채굴 켜기·끄기 전에 받는 확인 (데스크톱 대화상자·원격 클라이언트·헤드리스가 같은 종류와 문장을 쓴다)

/** 켜기·끄기 전에 사용자에게 받아야 하는 확인 */
export type ConfirmKind = 'consent' | 'danger' | 'stop' | 'sell';
/** 확인을 받으면 true. 헤드리스 API 는 요청에 확인이 없으면 NeedConfirm 을 던진다 */
export type Confirm = (kind: ConfirmKind, detail: string) => Promise<boolean>;

export class NeedConfirm extends Error {
  constructor(public kind: ConfirmKind, public detail: string) {
    super(`confirmation required: ${kind}`);
  }
}

/** 처음 켤 때 받는 위험·비용 고지 (데스크톱 대화상자·원격 클라이언트·헤드리스 안내에 같은 문장) */
export const CONSENT_TEXT = [
  '· 채굴은 전기 요금이 들고, GPU 발열·팬·커넥터 수명에 부담을 줍니다. 수익은 코인 시세·난이도에 따라 손실이 될 수 있습니다.',
  '· Crypthy 는 채굴기를 내려받거나 설치하지 않습니다. 직접 구성한 채굴기(예약 작업·유닛·실행 파일)를 켜고 끌 뿐이며, 채굴기와 그 수수료(dev fee)는 채굴기 배포처의 책임입니다.',
  '· 채굴 수익은 채굴기에 설정한 지갑으로만 지급됩니다. 앱은 수수료를 떼지 않습니다.',
  '· 안전 감시는 보조 수단입니다. 위험 조건이면 채굴기를 정지하고 다시 켜지 않습니다. 하드웨어 상태는 직접 확인해야 합니다.',
].join('\n');
