// Small inline SVG icons (no icon-library dependency).
import type { SVGProps } from "react";

const base = (props: SVGProps<SVGSVGElement>) => ({
  width: 16,
  height: 16,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  ...props,
});

export const IconLibrary = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
    <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
  </svg>
);

export const IconGraph = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <circle cx="5" cy="6" r="2.5" />
    <circle cx="19" cy="7" r="2.5" />
    <circle cx="12" cy="18" r="2.5" />
    <path d="M7 7.5 10.5 16M17.5 9 13 16.5M7 6.5h9.5" />
  </svg>
);

export const IconNote = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <path d="M14 2v6h6M9 13h6M9 17h6" />
  </svg>
);

export const IconPlus = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M12 5v14M5 12h14" />
  </svg>
);

export const IconTrash = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
  </svg>
);

export const IconSparkle = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3z" />
  </svg>
);

export const IconBack = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M19 12H5M12 19l-7-7 7-7" />
  </svg>
);

export const IconSearch = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <circle cx="11" cy="11" r="8" />
    <path d="m21 21-4.3-4.3" />
  </svg>
);

export const IconInbox = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M22 12h-6l-2 3h-4l-2-3H2" />
    <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
  </svg>
);

export const IconHome = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="m3 11 9-8 9 8" /><path d="M5 10v10h14V10M9 20v-6h6v6" /></svg>
);

export const IconCompass = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><circle cx="12" cy="12" r="9" /><path d="m15.5 8.5-2 5-5 2 2-5 5-2Z" /></svg>
);

export const IconQuestion = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><circle cx="12" cy="12" r="9" /><path d="M9.7 9a2.5 2.5 0 1 1 3.7 2.2c-.9.5-1.4 1-1.4 2M12 17h.01" /></svg>
);

export const IconArrowRight = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M5 12h14M13 6l6 6-6 6" /></svg>
);

export const IconCheck = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="m5 12 4 4L19 6" /></svg>
);

export const IconStar = ({ filled, ...p }: SVGProps<SVGSVGElement> & { filled?: boolean }) => (
  <svg {...base(p)} fill={filled ? "currentColor" : "none"}><path d="m12 2.8 2.8 5.7 6.3.9-4.6 4.4 1.1 6.3-5.6-3-5.6 3 1.1-6.3-4.6-4.4 6.3-.9L12 2.8Z" /></svg>
);

export const IconGrid = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></svg>
);

export const IconList = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M8 6h13M8 12h13M8 18h13" /><path d="M3 6h.01M3 12h.01M3 18h.01" /></svg>
);

export const IconCopy = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" /></svg>
);

export const IconFile = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /></svg>
);

export const IconChevron = ({ open, ...p }: SVGProps<SVGSVGElement> & { open?: boolean }) => (
  <svg {...base(p)} style={{ transform: open ? "rotate(90deg)" : undefined, transition: "transform 150ms ease", ...p.style }}>
    <path d="m9 6 6 6-6 6" />
  </svg>
);

export const IconDownload = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M12 3v12" /><path d="m7 11 5 5 5-5" /><path d="M4 20h16" /></svg>
);

export const IconFolder = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M3 7a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></svg>
);

export const IconPencil = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M4 20h4L19.5 8.5a2.1 2.1 0 0 0-3-3L5 17v3z" /><path d="m14.5 6.5 3 3" /></svg>
);

/**
 * The lattice mark: a five-node graph with a ring of links and one chord across it.
 * The same drawing as the app icon, so the dock, the browser tab, and the sidebar
 * are one mark rather than three. Matches client/public/lattice.svg.
 */
export const IconLatticeMark = (p: SVGProps<SVGSVGElement>) => (
  // Six nodes and one chord across them. The vertices sit off a true hexagon and the
  // radii vary, so it reads as a cluster that settled into this shape rather than a
  // shape that was drawn -- which is what the graph in the app actually looks like.
  // The drift is deliberate but small: past a certain point an irregular outline stops
  // reading as organic and starts reading as a mistake, and it stops surviving 16px.
  <svg
    width={28}
    height={28}
    viewBox="0 0 24 24"
    fill="none"
    aria-hidden="true"
    {...p}
  >
    <g stroke="currentColor" fill="none" strokeLinecap="round">
      <g strokeOpacity="0.5" strokeWidth="1.05">
        <path d="M13.1 4.7 5.6 8" />
        <path d="M5.6 8 6.9 15.9" />
        <path d="M6.9 15.9 11 19.2" />
        <path d="M11 19.2 18.6 15.4" />
        <path d="M18.6 15.4 17.1 8.6" />
        <path d="M17.1 8.6 13.1 4.7" />
      </g>
      {/* The chord: what keeps this from reading as a plain polygon. */}
      <g strokeOpacity="0.85" strokeWidth="1.2">
        <path d="M5.6 8 18.6 15.4" />
      </g>
    </g>
    <g fill="currentColor">
      <circle cx="13.1" cy="4.7" r="1.1" />
      <circle cx="5.6" cy="8" r="1.9" />
      <circle cx="6.9" cy="15.9" r="1.3" />
      <circle cx="11" cy="19.2" r="1.05" />
      <circle cx="18.6" cy="15.4" r="1.7" />
      <circle cx="17.1" cy="8.6" r="1.25" />
    </g>
  </svg>
);

export const IconShare = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M12 3v13" /><path d="m7 8 5-5 5 5" /><path d="M5 15v3a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-3" /></svg>
);

export const IconImport = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M12 16V3" /><path d="m7 11 5 5 5-5" /><path d="M5 15v3a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-3" /></svg>
);

export const IconMenu = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M4 6h16M4 12h16M4 18h16" /></svg>
);

export const IconClose = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M6 6l12 12M18 6 6 18" /></svg>
);

export const IconBrain = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M9.5 4a2.5 2.5 0 0 0-2.4 1.9A2.6 2.6 0 0 0 5 8.5c0 .5.1.9.3 1.3A2.8 2.8 0 0 0 4 12.2c0 1 .5 1.9 1.3 2.4-.2.4-.3.8-.3 1.3a2.6 2.6 0 0 0 2.6 2.6c.3 1.1 1.3 1.5 2.3 1.5 1.2 0 2.1-.9 2.1-2.1V6.1C12 4.9 11 4 9.5 4z" />
    <path d="M14.5 4a2.5 2.5 0 0 1 2.4 1.9A2.6 2.6 0 0 1 19 8.5c0 .5-.1.9-.3 1.3a2.8 2.8 0 0 1 1.3 2.4c0 1-.5 1.9-1.3 2.4.2.4.3.8.3 1.3a2.6 2.6 0 0 1-2.6 2.6c-.3 1.1-1.3 1.5-2.3 1.5-1.2 0-2.1-.9-2.1-2.1V6.1C12 4.9 13 4 14.5 4z" />
  </svg>
);
