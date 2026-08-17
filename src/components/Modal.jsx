import React, { useEffect } from "react";
import { X } from "lucide-react";

export default function Modal({
  title,
  close,
  children,
  footer = null,
}) {
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;

    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  return (
    <div
      className="overlay"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div className="modal">
        <div className="sheetHandle" aria-hidden="true" />

        <div className="modalHead">
          <h2>{title}</h2>

          <button
            type="button"
            onClick={close}
            aria-label="Fermer"
            className="modalClose"
          >
            <X size={21} strokeWidth={2.2} />
          </button>
        </div>

        <div className="modalContent">
          {children}
        </div>

        {footer && (
          <div className="modalFooter">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}