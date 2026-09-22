"use client";

import { Check, UserRound } from "lucide-react";
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

  return <ItemGroup className="gap-3">
    {passports.map(passport => {
      const selection = selections.find(value => value.passportId === passport.id);
      const selected = Boolean(selection);
      return <Item key={passport.id} variant="outline" className="items-start rounded-xl bg-card p-4 shadow-xs sm:flex-nowrap" role="listitem">
        <ItemMedia className="pt-0.5">
          <Checkbox
            className="size-5"
            checked={selected}
            disabled={!passport.valid || (!selected && (selections.length >= 10 || !categories.some(category => remainingFor(category) > 0)))}
            onCheckedChange={() => toggle(passport.id)}
            aria-label={`${selected ? "Remove" : "Select"} ${passport.name}`}
          />
        </ItemMedia>
        <ItemMedia variant="icon" className="rounded-full"><UserRound aria-hidden="true" /></ItemMedia>
        <ItemContent className="min-w-0">
          <ItemTitle className="flex-wrap text-base">
            {passport.name}
            {selected ? <Badge variant="secondary"><Check aria-hidden="true" />Selected</Badge> : null}
          </ItemTitle>
          <ItemDescription>{passport.relationship}</ItemDescription>
          {!passport.valid ? <p className="mt-1 text-sm text-destructive">Complete this Race Passport before booking.</p> : null}
        </ItemContent>
        <ItemActions className="w-full sm:w-64">
          <Select value={selection?.categoryId ?? ""} disabled={!selected} onValueChange={value => setCategory(passport.id, value)}>
            <SelectTrigger className="h-11 w-full" aria-label={`Category for ${passport.name}`}>
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
