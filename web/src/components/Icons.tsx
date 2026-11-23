import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function Svg({ size = 16, children, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.65"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {children}
    </svg>
  );
}

export function IconBoard(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="3" y="4" width="8" height="7" rx="1.6" />
      <rect x="13" y="4" width="8" height="7" rx="1.6" />
      <rect x="3" y="13" width="8" height="7" rx="1.6" />
      <rect x="13" y="13" width="8" height="7" rx="1.6" />
    </Svg>
  );
}

export function IconList(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="3" y="5" width="7" height="5" rx="1.2" />
      <path d="M13 6.5h8M13 9.5h5" />
      <rect x="3" y="14" width="7" height="5" rx="1.2" />
      <path d="M13 15.5h8M13 18.5h5" />
    </Svg>
  );
}

export function IconScript(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M6 3.5h8.5L19 8v12.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 20.5V5A1.5 1.5 0 0 1 6.5 3.5Z" />
      <path d="M14 3.5V8h4.5M8.5 12h7M8.5 15.5h7M8.5 8.5h3" />
    </Svg>
  );
}

export function IconAssets(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="3" y="4.5" width="18" height="15" rx="2.2" />
      <circle cx="8.5" cy="10" r="1.6" />
      <path d="m21 15.5-5.2-4.8a1.2 1.2 0 0 0-1.7 0L5.5 19.5" />
    </Svg>
  );
}

export function IconClapper(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 11h16v8.5A1.5 1.5 0 0 1 18.5 21h-13A1.5 1.5 0 0 1 4 19.5V11Z" />
      <path d="m4 11 15.2-4.2a1.2 1.2 0 0 0 .8-1.5l-.6-2a1.2 1.2 0 0 0-1.5-.8L3.4 6.7a1.2 1.2 0 0 0-.8 1.5L4 11Z" />
      <path d="m9.5 5.2 2.4 4.2M15 3.7l2.4 4.2M10.5 14l4.5 2.2-4.5 2.3V14Z" />
    </Svg>
  );
}

export function IconSparkles(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="m12 3 1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8L12 3Z" />
      <path d="m18.5 15.5.9 2.1 2.1.9-2.1.9-.9 2.1-.9-2.1-2.1-.9 2.1-.9.9-2.1Z" />
    </Svg>
  );
}

export function IconUpload(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 15.5V4.5m0 0-4 4m4-4 4 4" />
      <path d="M4 15.5v3A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5v-3" />
    </Svg>
  );
}

export function IconSearch(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m16 16 4.2 4.2" />
    </Svg>
  );
}

export function IconQuote(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M7 8h10M7 12h6" />
      <path d="M4 5.5A1.5 1.5 0 0 1 5.5 4h13A1.5 1.5 0 0 1 20 5.5v10a1.5 1.5 0 0 1-1.5 1.5H9l-4 3v-3H5.5A1.5 1.5 0 0 1 4 15.5v-10Z" />
    </Svg>
  );
}

export function IconChatBubble(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M5.5 5.5h13A1.5 1.5 0 0 1 20 7v8.5a1.5 1.5 0 0 1-1.5 1.5H10l-3.8 2.8V17H5.5A1.5 1.5 0 0 1 4 15.5V7a1.5 1.5 0 0 1 1.5-1.5Z" />
    </Svg>
  );
}

export function IconPin(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="m15 4.5 4.5 4.5-2.2 2.2-.8 4.3-6.5-6.5 4.3-.8L15 4.5Z" />
      <path d="M9.5 14.5 4.5 19.5" />
    </Svg>
  );
}

export function IconEdit(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M15.8 4.7a1.8 1.8 0 0 1 2.5 2.5L8.5 17l-3.8.9.9-3.8 10.2-9.4Z" />
      <path d="M5 20h14" />
    </Svg>
  );
}

export function IconTrash(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4.5 7h15M9.5 7V5a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v2" />
      <path d="M6.8 7l.8 12a1.5 1.5 0 0 0 1.5 1.4h5.8a1.5 1.5 0 0 0 1.5-1.4L17.2 7" />
      <path d="M10 11v5M14 11v5" />
    </Svg>
  );
}

export function IconMore(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="5.5" cy="12" r="1.25" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.25" fill="currentColor" stroke="none" />
      <circle cx="18.5" cy="12" r="1.25" fill="currentColor" stroke="none" />
    </Svg>
  );
}

export function IconSidebar(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
      <path d="M9.5 4.5v15" />
    </Svg>
  );
}

export function IconTrace(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="6" cy="6" r="2" />
      <circle cx="18" cy="12" r="2" />
      <circle cx="6" cy="18" r="2" />
      <path d="M8 6h4a4 4 0 0 1 4 4v0M16 12H10a4 4 0 0 0-4 4v0" />
    </Svg>
  );
}

export function IconSend(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="m4 11.5 15.5-7-5.5 15.5-2.8-6-7.2-2.5Z" />
      <path d="m11.2 14 8.3-9.5" />
    </Svg>
  );
}

export function IconChevron(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="m9 6 6 6-6 6" />
    </Svg>
  );
}
