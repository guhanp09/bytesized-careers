import Image from "next/image";

type BrandLogoProps = {
  height: 32 | 40 | 30;
  alt?: string;
  className?: string;
};

export default function BrandLogo({ height, alt = "CreatorJobs", className = "" }: BrandLogoProps) {
  return (
    <span className={`inline-flex items-center leading-[0] ${className}`.trim()}>
      <Image
        src="/brand/logo-mark-96.png"
        alt={alt}
        width={142}
        height={96}
        style={{ height, width: "auto", display: "block" }}
        className="select-none"
        priority
        draggable={false}
      />
    </span>
  );
}
