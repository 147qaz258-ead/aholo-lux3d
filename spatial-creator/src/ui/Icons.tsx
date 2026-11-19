type P = { size?: number; className?: string };

const base = (size = 18) => ({
  width: size,
  height: size,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.3,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
});

export const IconSelect = ({ size }: P) => (
  <svg {...base(size)}>
    <path d="M5 3l14 8-6 1.6L10.4 19 5 3z" />
  </svg>
);

export const IconPen = ({ size }: P) => (
  <svg {...base(size)}>
    <path d="M4 20l3.2-.7 10.4-10.4a2 2 0 0 0 0-2.8l-.7-.7a2 2 0 0 0-2.8 0L3.7 15.8 3 19l1 1z" />
    <path d="M14 6.5l3.5 3.5" />
  </svg>
);

export const IconSculpt = ({ size }: P) => (
  <svg {...base(size)}>
    <path d="M9 11V5.5a1.5 1.5 0 0 1 3 0V11" />
    <path d="M12 11V4.5a1.5 1.5 0 0 1 3 0V11" />
    <path d="M15 11V6.5a1.5 1.5 0 0 1 3 0V13c0 4.5-2.6 7.5-6.5 7.5S5 17 5 13v-2a1.5 1.5 0 0 1 3 0v2" />
    <path d="M18 9.5a1.5 1.5 0 0 1 2 1.4" />
  </svg>
);

export const IconSpark = ({ size }: P) => (
  <svg {...base(size)}>
    <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3z" />
    <path d="M18.5 16.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8.8-2.2z" />
  </svg>
);

export const IconSave = ({ size }: P) => (
  <svg {...base(size)}>
    <path d="M5 4h11l3 3v13H5z" />
    <path d="M8 4v5h7V4" />
    <path d="M8 20v-6h8v6" />
  </svg>
);

export const IconDownload = ({ size }: P) => (
  <svg {...base(size)}>
    <path d="M12 3v11" />
    <path d="M7.5 10L12 14.5 16.5 10" />
    <path d="M4 19h16" />
  </svg>
);

export const IconTrash = ({ size }: P) => (
  <svg {...base(size)}>
    <path d="M4 7h16" />
    <path d="M9 7V4.5h6V7" />
    <path d="M6 7l1 13h10l1-13" />
  </svg>
);

export const IconHelp = ({ size }: P) => (
  <svg {...base(size)}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M9.6 9.4a2.5 2.5 0 1 1 3.6 2.3c-.7.4-1.2 1-1.2 1.8" />
    <path d="M12 17h.01" />
  </svg>
);

export const IconCamera = ({ size }: P) => (
  <svg {...base(size)}>
    <rect x="3" y="6.5" width="12.5" height="11" rx="2" />
    <path d="M15.5 11l5-2.5v7L15.5 13" />
  </svg>
);

export const IconUndo = ({ size }: P) => (
  <svg {...base(size)}>
    <path d="M4 9h9a5 5 0 0 1 0 10h-3" />
    <path d="M7.5 5.5L4 9l3.5 3.5" />
  </svg>
);

export const IconPlus = ({ size }: P) => (
  <svg {...base(size)}>
    <path d="M12 5v14M5 12h14" />
  </svg>
);

export const IconClose = ({ size }: P) => (
  <svg {...base(size)}>
    <path d="M6 6l12 12M18 6L6 18" />
  </svg>
);

export const IconImage = ({ size }: P) => (
  <svg {...base(size)}>
    <rect x="3" y="4.5" width="18" height="15" rx="2" />
    <circle cx="8.5" cy="9.5" r="1.6" />
    <path d="M4 17l5-5 4 4 3-2.5 4 3.5" />
  </svg>
);

export const IconMic = ({ size }: P) => (
  <svg {...base(size)}>
    <rect x="9" y="3" width="6" height="12" rx="3" />
    <path d="M6 11v1a6 6 0 0 0 12 0v-1m-6 7v3m-3 0h6" />
  </svg>
);

export const IconEyeOff = ({ size }: P) => (
  <svg {...base(size)}>
    <path d="M3 12s3.5-6 9-6 9 6 9 6-3.5 6-9 6-9-6-9-6z" />
    <path d="M4 4l16 16" />
  </svg>
);

export const IconEye = ({ size }: P) => (
  <svg {...base(size)}>
    <path d="M3 12s3.5-6 9-6 9 6 9 6-3.5 6-9 6-9-6-9-6z" />
    <circle cx="12" cy="12" r="2.4" />
  </svg>
);

export const IconLock = ({ size }: P) => (
  <svg {...base(size)}>
    <rect x="5" y="10.5" width="14" height="9.5" rx="1.6" />
    <path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" />
  </svg>
);

export const IconUnlock = ({ size }: P) => (
  <svg {...base(size)}>
    <rect x="5" y="10.5" width="14" height="9.5" rx="1.6" />
    <path d="M8.5 10.5V8a3.5 3.5 0 0 1 6.6-1.6" />
  </svg>
);

export const IconLayers = ({ size }: P) => (
  <svg {...base(size)}>
    <path d="M12 3l9 5-9 5-9-5 9-5z" />
    <path d="M3 13l9 5 9-5" />
  </svg>
);

export const IconContrast = ({ size }: P) => (
  <svg {...base(size)}>
    <circle cx="12" cy="12" r="8.6" />
    <path d="M12 3.4a8.6 8.6 0 0 1 0 17.2z" fill="currentColor" stroke="none" />
  </svg>
);
