// 업데이트 안내를 확실히 보이게 하는 부분.
//  - OS 알림 객체는 클릭될 때까지 참조를 유지한다(Windows 에서 지역 변수로 두면 GC 되어 click 이벤트가 사라진다)
//  - 선택지(받기/나중에, 재시작해 설치/나중에)는 인앱 배너에만 둔다. OS 알림은 창이 안 보일 때만 1번
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

/**
 * 새 안내에 OS 알림(토스트)을 띄울지. 창이 보이면 배너로 충분하고(중복 방지), 사용자가 직접 확인한 경우도 배너만.
 * 같은 버전·단계의 반복은 updater 의 onPrompt 가 이미 막는다.
 */
export function updateToast(v: UpdateView, o: { windowVisible: boolean; manual: boolean }): { title: string; body: string } | null {
  if (o.windowVisible || o.manual) return null;
  if (v.status === 'ready') return { title: 'Crypthy 업데이트', body: `v${v.version} 를 받아 두었습니다. 눌러서 앱의 안내에서 재시작해 설치할 수 있습니다 — 채굴은 계속됩니다` };
  if (v.status === 'available') return { title: 'Crypthy 업데이트', body: `새 버전 v${v.version} 이 있습니다. 눌러서 앱의 안내에서 받기 / 나중에 를 고르세요` };
  return null;
}
