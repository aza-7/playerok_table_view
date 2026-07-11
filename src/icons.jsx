function Icon({ children, size = 16, viewBox = "0 0 16 16", strokeWidth = 1.5 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox={viewBox}
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export function IconDuplicate() {
  return (
    <Icon>
      <rect x="5.5" y="5.5" width="8" height="8" rx="1.6" />
      <path d="M10.5 3.5A1.5 1.5 0 0 0 9 2H4a1.5 1.5 0 0 0-1.5 1.5V9A1.5 1.5 0 0 0 4 10.5" />
      <circle cx="9.5" cy="9.5" r="0.9" fill="currentColor" stroke="none" />
    </Icon>
  );
}

export function IconDuplicateNoPhoto() {
  return (
    <Icon>
      <rect x="5.5" y="5.5" width="8" height="8" rx="1.6" />
      <path d="M10.5 3.5A1.5 1.5 0 0 0 9 2H4a1.5 1.5 0 0 0-1.5 1.5V9A1.5 1.5 0 0 0 4 10.5" />
      <path d="M7.5 9.5h4" />
    </Icon>
  );
}

export function IconPublish() {
  return (
    <Icon>
      <path d="M3 2.5h10" />
      <path d="M8 13.5V5.5" />
      <path d="m4.5 9 3.5-3.5L11.5 9" />
    </Icon>
  );
}

export function IconSave() {
  return (
    <Icon>
      <path d="M2.5 4A1.5 1.5 0 0 1 4 2.5h6.8L13.5 5.2V12a1.5 1.5 0 0 1-1.5 1.5H4A1.5 1.5 0 0 1 2.5 12V4Z" />
      <path d="M5 2.5V6h5V2.5" />
      <path d="M5 13.5V9.5h6v4" />
    </Icon>
  );
}

export function IconTrash() {
  return (
    <Icon>
      <path d="M2.8 4.3h10.4" />
      <path d="M6.3 4.3V3.2a1 1 0 0 1 1-1h1.4a1 1 0 0 1 1 1v1.1" />
      <path d="m4.2 4.3.5 8.2a1.4 1.4 0 0 0 1.4 1.3h3.8a1.4 1.4 0 0 0 1.4-1.3l.5-8.2" />
      <path d="M6.6 7v4.2M9.4 7v4.2" />
    </Icon>
  );
}

export function IconGear() {
  return (
    <Icon viewBox="0 0 24 24" strokeWidth={2.1}>
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
      <circle cx="12" cy="12" r="3" />
    </Icon>
  );
}

export function IconClose() {
  return (
    <Icon>
      <path d="m4 4 8 8M12 4l-8 8" />
    </Icon>
  );
}
