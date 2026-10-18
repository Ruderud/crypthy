// 업데이트 안내를 확실히 보이게 하는 부분.
//  - OS 알림 객체는 클릭될 때까지 참조를 유지한다(Windows 에서 지역 변수로 두면 GC 되어 click 이벤트가 사라진다)
//  - 알림 클릭·수동 확인 때는 네이티브 대화상자로 선택지를 띄운다(인앱 배너는 그대로 유지)
import type { UpdateView } from '../shared/types';

export interface NotificationLike {
  on(event: 'click' | 'close' | 'failed', listener: (...args: unknown[]) => void): unknown;
  show(): void;
}

/** 알림을 클릭·닫기·실패 전까지 붙잡아 둔다 */
export function createNotificationKeeper() {
  const live = new Set<NotificationLike>();
  return {
    show(n: NotificationLike, onClick: () => void): void {
      live.add(n);
      n.on('click', () => {
        live.delete(n);
        onClick();
      });
      n.on('close', () => live.delete(n));
      n.on('failed', () => live.delete(n));
      n.show();
    },
    size: () => live.size,
  };
}

export interface UpdateDialogSpec {
  action: 'download' | 'install';
  title: string;
  message: string;
  detail: string;
  buttons: [string, string];
}

/** 지금 안내할 업데이트가 있으면 대화상자 내용을, 없으면 null */
export function updateDialogSpec(v: UpdateView, appVersion: string, appName = 'Crypthy'): UpdateDialogSpec | null {
  const notes = v.notes ? `\n\n${v.notes}` : '';
  if (v.status === 'ready') {
    return {
      action: 'install',
      title: `${appName} 업데이트`,
      message: `v${v.version} 를 받아 두었습니다. 지금 재시작해 설치할까요?`,
      detail: `현재 v${appVersion}. 재시작하면 몇 초 뒤 새 버전으로 다시 열립니다. 채굴기는 앱과 따로 실행되므로 채굴은 계속되고, 재시작하는 동안 안전 감시만 잠시 멈춥니다.${notes}`,
      buttons: ['지금 재시작해 설치', '나중에'],
    };
  }
  if (v.status === 'available') {
    return {
      action: 'download',
      title: `${appName} 업데이트`,
      message: `새 버전 v${v.version} 이 있습니다. 받을까요?`,
      detail: `현재 v${appVersion}. 백그라운드로 내려받고, 다 받으면 설치할지 다시 묻습니다.${notes}`,
      buttons: ['받기', '나중에'],
    };
  }
  return null;
}
