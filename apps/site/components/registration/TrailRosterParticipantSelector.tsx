"use client";

import { Check } from "lucide-react";
import { formatPeso } from "@race-pace/shared";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle } from "@/components/ui/item";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export type RosterPassport = {
  id: string;
  name: string;
  relationship: string;
  valid: boolean;
};

export type RosterCategory = {
  id: string;
  label: string;
  price: number;
  available: number;
};

export type RosterSelection = { passportId: string; categoryId: string };

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]?.toUpperCase()).join("");
}

export function TrailRosterParticipantSelector({ passports, categories, selections, onSelectionsChange }: {
  passports: RosterPassport[];
  categories: RosterCategory[];
  selections: RosterSelection[];
  onSelectionsChange: (next: RosterSelection[]) => void;
}) {
  function remainingFor(category: RosterCategory, exceptPassportId?: string) {
    const alreadyAssigned = selections.filter(selection =>
      selection.categoryId === category.id && selection.passportId !== exceptPassportId
    ).length;
    return Math.max(0, category.available - alreadyAssigned);
  }

  function toggle(passportId: string) {
    const current = selections.find(selection => selection.passportId === passportId);
    if (current) {
      onSelectionsChange(selections.filter(selection => selection.passportId !== passportId));
      return;
    }
    const firstAvailable = categories.find(category => remainingFor(category) > 0);
    if (firstAvailable) onSelectionsChange([...selections, { passportId, categoryId: firstAvailable.id }]);
  }

  function setCategory(passportId: string, categoryId: string) {
    onSelectionsChange(selections.map(selection => selection.passportId === passportId ? { ...selection, categoryId } : selection));
  }

  return <ItemGroup className="gap-2.5" role="list">
    {passports.map(passport => {
      const selection = selections.find(value => value.passportId === passport.id);
      const selected = Boolean(selection);
      return <Item key={passport.id} variant="outline" className="grid min-h-[78px] grid-cols-[44px_42px_minmax(0,1fr)] items-center gap-x-3 gap-y-2 rounded-xl border-[#dce3de] bg-card px-3.5 py-3 shadow-none transition-[border-color,box-shadow] motion-reduce:transition-none data-[selected=true]:border-primary/45 data-[selected=true]:shadow-[0_0_0_1px_rgba(21,154,85,0.08)] sm:grid-cols-[44px_46px_minmax(0,1fr)_190px]" role="listitem" data-selected={selected}>
        <ItemMedia className="flex size-11 items-center justify-center">
          <Checkbox
            className="size-5 rounded-[5px] border-[#aeb8b1] data-[state=checked]:border-primary data-[state=checked]:bg-primary"
            checked={selected}
            disabled={!passport.valid || (!selected && (selections.length >= 10 || !categories.some(category => remainingFor(category) > 0)))}
            onCheckedChange={() => toggle(passport.id)}
            aria-label={`${selected ? "Remove" : "Select"} ${passport.name}`}
          />
        </ItemMedia>
        <ItemMedia className="flex size-11 items-center justify-center rounded-full bg-[#e8f5ee] text-xs font-bold tracking-[0.04em] text-[#0c6d3b]" aria-hidden="true">
          {initials(passport.name)}
        </ItemMedia>
        <ItemContent className="min-w-0 gap-0.5">
          <ItemTitle className="flex-wrap gap-2 text-[15px] font-bold leading-5 text-[#14211a]">
            {passport.name}
            {selected ? <Badge variant="secondary" className="h-6 rounded-full bg-[#e8f5ee] px-2 text-[11px] font-semibold text-[#0c6d3b]"><Check aria-hidden="true" className="size-3" />Selected</Badge> : null}
          </ItemTitle>
          <ItemDescription className="text-[13px] leading-5 text-[#657069]">{passport.relationship}</ItemDescription>
          {!passport.valid ? <p className="mt-1 text-sm text-destructive">Complete this Race Passport before booking.</p> : null}
        </ItemContent>
        <ItemActions className="col-[2/-1] w-full sm:col-auto sm:w-[190px]">
          <Select value={selection?.categoryId ?? ""} disabled={!selected} onValueChange={value => setCategory(passport.id, value)}>
            <SelectTrigger className="h-[46px] w-full rounded-[10px] border-[#dce3de] bg-white px-3 text-[13px] shadow-none disabled:bg-[#f3f5f1]" aria-label={`Category for ${passport.name}`}>
              <SelectValue placeholder="Choose category" />
            </SelectTrigger>
            <SelectContent>
              {categories.map(category => {
                const remaining = remainingFor(category, passport.id);
                return <SelectItem key={category.id} value={category.id} disabled={remaining < 1}>
                  {category.label} · {formatPeso(category.price)} · {remaining} left
                </SelectItem>;
              })}
            </SelectContent>
          </Select>
        </ItemActions>
      </Item>;
    })}
  </ItemGroup>;
}
