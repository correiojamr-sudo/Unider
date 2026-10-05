import { useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useModalAccessibility } from '../../hooks/useModalAccessibility';

export default function ModalFrame({ children, header, titleId, descriptionId, onDismiss, className }: {
  children: ReactNode; header?: ReactNode; titleId: string; descriptionId: string; onDismiss?: () => void; className: string;
}) {
  const overlay = useRef<HTMLDivElement>(null);
  const dialog = useRef<HTMLDivElement>(null);
  useModalAccessibility(overlay, dialog, onDismiss);
  return createPortal(
    <div ref={overlay} className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4 z-50">
      <div ref={dialog} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={descriptionId}
        tabIndex={-1} className={`bg-slate-900 border border-slate-800 rounded-2xl w-full p-6 flex flex-col gap-6 shadow-2xl relative max-h-[calc(100dvh-2rem)] ${className}`}>
        {header && <div className="shrink-0">{header}</div>}
        <div className="min-h-0 overflow-y-auto space-y-6">{children}</div>
      </div>
    </div>, document.body);
}
