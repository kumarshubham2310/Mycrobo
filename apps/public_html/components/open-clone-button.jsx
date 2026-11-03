"use client";
export function OpenCloneButton({ children, className, onOpen }) {
  return (
    <button
      className={className}
      type="button"
      onClick={() => {
        onOpen?.();
        window.dispatchEvent(new Event("mycrobo:open-clone"));
      }}
    >
      {children}
    </button>
  );
}
