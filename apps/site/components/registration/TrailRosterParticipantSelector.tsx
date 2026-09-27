"use client";


import { Check } from "lucide-react";
import { formatPeso } from "@race-pace/shared";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
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
      return <Item key={passport.id} variant="outline" className="grid min-h-[78px] grid-cols-[44px_42px_minmax(0,1fr)] items-center gap-x-3 gap-y-2 px-3.5 py-3 transition-[border-color,box-shadow] motion-reduce:transition-none sm:grid-cols-[44px_46px_minmax(0,1fr)_190px]" role="listitem" data-selected={selected}>
        <ItemMedia className="flex size-11 items-center justify-center">
          <Checkbox
            className="size-5"
            checked={selected}
            disabled={!passport.valid || (!selected && (selections.length >= 10 || !categories.some(category => remainingFor(category) > 0)))}
            onCheckedChange={() => toggle(passport.id)}
            aria-label={`${selected ? "Remove" : "Select"} ${passport.name}`}
          />
        </ItemMedia>
        <ItemMedia aria-hidden="true">
          <Avatar className="size-11"><AvatarFallback>{initials(passport.name)}</AvatarFallback></Avatar>
        </ItemMedia>
        <ItemContent className="min-w-0 gap-0.5">
          <ItemTitle className="flex-wrap gap-2 text-[15px] font-bold leading-5">
            {passport.name}
            {selected ? <Badge variant="secondary" className="h-6 px-2"><Check aria-hidden="true" className="size-3" />Selected</Badge> : null}
          </ItemTitle>
          <ItemDescription className="text-[13px] leading-5">{passport.relationship}</ItemDescription>
          {!passport.valid ? <p className="mt-1 text-sm text-destructive">Complete this Race Passport before booking.</p> : null}
        </ItemContent>
        <ItemActions className="col-[2/-1] w-full sm:col-auto sm:w-[190px]">
          <Select value={selection?.categoryId ?? ""} disabled={!selected} onValueChange={value => setCategory(passport.id, value)}>
            <SelectTrigger className="h-[46px] w-full px-3" aria-label={`Category for ${passport.name}`}>
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
