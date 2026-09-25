import type { SVGProps } from "react";

const paths = {
  bowl: (
    <>
      <path d="M3 11h18a9 9 0 0 1-18 0Z" />
      <path d="M8 21h8M8 7c-2-2 2-3 0-5m4 5c-2-2 2-3 0-5m4 5c-2-2 2-3 0-5" />
    </>
  ),
  pin: (
    <>
      <path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0Z" />
      <circle cx="12" cy="10" r="2.5" />
    </>
  ),
  arrow: <path d="M5 12h14m-6-6 6 6-6 6" />,
  send: <path d="M12 19V5m-6 6 6-6 6 6" />,
  mic: (
    <>
      <rect x="9" y="2" width="6" height="13" rx="3" />
      <path d="M5 10v2a7 7 0 0 0 14 0v-2m-7 9v3m-3 0h6" />
    </>
  ),
  stop: <rect x="6" y="6" width="12" height="12" rx="2" />,
  bell: (
    <>
      <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  leaf: (
    <>
      <path d="M20 4C9 1 1 10 6 17s17 1 14-13Z" />
      <path d="M4 21 16 9" />
    </>
  ),
  chevron: <path d="m8 10 4 4 4-4" />,
} as const;

export default function Icon({
  name,
  ...props
}: SVGProps<SVGSVGElement> & { name: keyof typeof paths }) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {paths[name]}
    </svg>
  );
}
