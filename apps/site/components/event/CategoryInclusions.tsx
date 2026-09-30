import { Check } from "lucide-react";

export function CategoryInclusions({ items }: { items: string[] }) {
  if (!items.length) return null;
  return (
    <div className="text-sm leading-[1.55]">
      <h4 className="mb-2.5 font-[650]">What’s included</h4>
      <ul aria-label="What’s included" className="grid grid-cols-1 gap-x-6 gap-y-2 min-[390px]:grid-cols-2">
        {items.map((item, index) => (
          <li key={index} className="flex min-w-0 items-start gap-[9px]">
            <Check aria-hidden="true" className="mt-1 size-[15px] shrink-0 opacity-65" strokeWidth={1.6} />
            <span className="min-w-0 break-words">{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
