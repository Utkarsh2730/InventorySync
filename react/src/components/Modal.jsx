import { useEffect, useId, useRef, useState } from 'react';

// A Bootstrap-styled modal driven by React state (no Bootstrap JS needed).
// Focus moves into the dialog, Tab stays inside it, Escape closes it, and
// focus returns to the button that opened it.
export default function Modal({ title, submitLabel, onClose, onSubmit, errors, children }) {
  const titleId = useId();
  const dialogRef = useRef(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const [validated, setValidated] = useState(false);

  useEffect(() => {
    const previous = document.activeElement;
    const focusables = () => [...dialogRef.current.querySelectorAll(
      'input, select, textarea, button, [href], [tabindex]:not([tabindex="-1"])',
    )].filter((el) => !el.disabled);
    const firstField = dialogRef.current.querySelector('input, select');
    (firstField || focusables()[0])?.focus();

    const onKey = (e) => {
      if (e.key === 'Escape') onCloseRef.current();
      if (e.key !== 'Tab') return;
      const items = focusables();
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    document.body.classList.add('modal-open');
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.classList.remove('modal-open');
      if (previous && previous.focus) previous.focus();
    };
  }, []);

  // Browser validation first (was-validated shows invalid-feedback), then the rule.
  const handleSubmit = (e) => {
    e.preventDefault();
    setValidated(true);
    if (!e.currentTarget.checkValidity()) return;
    onSubmit();
  };

  return (
    <>
      <div
        className="modal fade show d-block"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onMouseDown={(e) => e.target === e.currentTarget && onClose()}
      >
        <div className="modal-dialog" ref={dialogRef}>
          <form className={`modal-content${validated ? ' was-validated' : ''}`} noValidate onSubmit={handleSubmit}>
            <div className="modal-header">
              <h2 className="modal-title h5" id={titleId}>{title}</h2>
              <button type="button" className="btn-close" aria-label="Close" onClick={onClose} />
            </div>
            <div className="modal-body">
              {errors && errors.length > 0 && (
                <div className="alert alert-danger" role="alert">
                  <p className="fw-semibold mb-1">Refused. Nothing was changed:</p>
                  <ul className="mb-0">{errors.map((e) => <li key={e}>{e}</li>)}</ul>
                </div>
              )}
              {children}
            </div>
            <div className="modal-footer">
              <button type="button" className="btn btn-outline-secondary" onClick={onClose}>Cancel</button>
              <button type="submit" className="btn btn-primary">{submitLabel}</button>
            </div>
          </form>
        </div>
      </div>
      <div className="modal-backdrop fade show" />
    </>
  );
}
