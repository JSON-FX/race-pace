"use client";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@race-pace/ui/ui/collapsible";
import { Button } from "@/components/ui/button";
export function CategoryInclusions({ items }: { items: string[] }) {
  if (!items.length) return null;
  return <Collapsible className="text-sm"><CollapsibleTrigger asChild><Button variant="ghost" className="h-auto px-0 py-1 font-semibold">What’s included</Button></CollapsibleTrigger><CollapsibleContent><ul className="mt-2 list-disc space-y-1 pl-5">{items.map((item,index) => <li key={index}>{item}</li>)}</ul></CollapsibleContent></Collapsible>;
}
