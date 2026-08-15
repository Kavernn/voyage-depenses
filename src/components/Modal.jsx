import React from 'react';
import { X } from 'lucide-react';

export default function Modal({
  title,
  close,
  children
}) {
  return (
    <div className="overlay">
      <div className="modal">
        <div className="modalHead">
          <h2>{title}</h2>

          <button onClick={close}>
            <X />
          </button>
        </div>

        {children}
      </div>
    </div>
  );
}