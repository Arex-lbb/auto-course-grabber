import { useEffect, useState } from 'react';

export interface ToastMessage {
  id: number;
  type: 'info' | 'success' | 'error' | 'warning';
  text: string;
}

export default function Toast({ toasts, onDismiss }: { toasts: ToastMessage[]; onDismiss: (id: number) => void }) {
  return (
    <div style={{ position: 'fixed', top: 12, right: 12, zIndex: 9999, display: 'flex', flexDirection: 'column', gap: 8 }}>
      {toasts.map(t => (
        <ToastItem key={t.id} toast={t} onDismiss={onDismiss} />
      ))}
    </div>
  );
}

function ToastItem({ toast, onDismiss }: { toast: ToastMessage; onDismiss: (id: number) => void }) {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => {
      setVisible(false);
      setTimeout(() => onDismiss(toast.id), 300);
    }, 5000);
    return () => clearTimeout(timer);
  }, [toast.id, onDismiss]);

  const bg = toast.type === 'error' ? '#d9363e' : toast.type === 'warning' ? '#e6a23c' : toast.type === 'success' ? '#2b9c4a' : '#2f7dfa';

  return (
    <div
      onClick={() => { setVisible(false); setTimeout(() => onDismiss(toast.id), 300); }}
      style={{
        background: bg,
        color: '#fff',
        padding: '10px 16px',
        borderRadius: 8,
        fontSize: 13,
        cursor: 'pointer',
        maxWidth: 400,
        wordBreak: 'break-word',
        opacity: visible ? 1 : 0,
        transform: visible ? 'translateX(0)' : 'translateX(20px)',
        transition: 'opacity 0.3s, transform 0.3s',
        boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
      }}
    >
      {toast.text}
    </div>
  );
}
