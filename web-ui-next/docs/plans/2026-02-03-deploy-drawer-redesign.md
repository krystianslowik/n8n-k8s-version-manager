# Deploy Drawer Redesign Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Reorganize the deploy drawer into a cleaner layout that separates essential settings from advanced configuration.

**Architecture:** Convert the current form into two sections: (1) Essential settings in a Card component (version, mode, snapshot), (2) HelmValuesEditor in a collapsible Accordion. Remove broken custom name feature. Reset accordion state when drawer closes.

**Tech Stack:** React 19, shadcn/ui (Accordion, Card, RadioGroup), TanStack React Query

---

## Current State Analysis

The deploy drawer currently has:
- Version selection (searchable popover + quick badges)
- Mode selection (queue/regular radio)
- Initial data snapshot selection
- Advanced options (collapsed, contains custom name) - REMOVING (broken)
- HelmValuesEditor (5 tabs) - will wrap in Accordion
- Capacity warning banner
- Deploy button

**Note:** Skeleton loading already exists for version/snapshot dropdowns - no changes needed there.

---

### Task 1: Remove Custom Name and Advanced Options Collapsible

**Files:**
- Modify: `web-ui-next/components/deploy-drawer.tsx`

**Step 1: Remove customName state**

Find and delete:
```tsx
const [customName, setCustomName] = useState('')
```

**Step 2: Remove advancedOpen state**

Find and delete:
```tsx
const [advancedOpen, setAdvancedOpen] = useState(false)
```

**Step 3: Remove the entire Advanced Options collapsible section**

Find and delete the entire `{/* Advanced Options */}` Collapsible block that contains the custom name input.

**Step 4: Remove customName from deploy mutation payload**

Find the deploy mutation call and remove `customName` from the payload if it's being passed.

**Step 5: Remove Collapsible imports**

Remove these imports (they won't be needed after this change):
```tsx
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
```

**Step 6: Verify and commit**

Run: `cd web-ui-next && npm run build`
Expected: Build succeeds

```bash
git add web-ui-next/components/deploy-drawer.tsx
git commit -m "refactor(drawer): remove broken custom name feature"
```

---

### Task 2: Wrap HelmValuesEditor in Accordion

**Files:**
- Modify: `web-ui-next/components/deploy-drawer.tsx`

**Step 1: Import Accordion components**

Add to imports:
```tsx
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'
```

**Step 2: Add SettingsIcon import**

Add to lucide-react imports:
```tsx
import { ..., SettingsIcon } from 'lucide-react'
```

**Step 3: Find the Configuration section and wrap in Accordion**

Find the current Configuration section with HelmValuesEditor and replace with:
```tsx
{/* Configuration - Collapsible Accordion */}
<Accordion type="single" collapsible className="border-t pt-2">
  <AccordionItem value="config" className="border-none">
    <AccordionTrigger className="py-3 hover:no-underline">
      <div className="flex items-center gap-2">
        <SettingsIcon className="h-4 w-4" />
        <span className="text-sm font-medium">Advanced Configuration</span>
      </div>
    </AccordionTrigger>
    <AccordionContent className="pt-2 pb-0">
      <HelmValuesEditor
        values={helmValues}
        onChange={setHelmValues}
        mode={mode}
      />
    </AccordionContent>
  </AccordionItem>
</Accordion>
```

**Step 4: Verify and commit**

Run: `cd web-ui-next && npm run dev`
- "Advanced Configuration" appears as accordion header
- Click to expand shows HelmValuesEditor tabs
- Accordion collapses when clicked again

```bash
git add web-ui-next/components/deploy-drawer.tsx
git commit -m "refactor(drawer): wrap helm editor in accordion"
```

---

### Task 3: Group Essential Settings in Card + Reset State on Close

**Files:**
- Modify: `web-ui-next/components/deploy-drawer.tsx`

**Step 1: Import Card components**

Add to imports:
```tsx
import { Card, CardContent } from '@/components/ui/card'
```

**Step 2: Wrap essential fields in Card**

Find the section with Version Selection, Mode Selection, and Initial Data (Snapshot). Wrap them in a Card:
```tsx
{/* Essential Settings */}
<Card className="border-dashed">
  <CardContent className="pt-4 space-y-4">
    {/* Version Selection */}
    <div className="space-y-2">
      ...
    </div>

    {/* Mode Selection */}
    <div className="space-y-2">
      ...
    </div>

    {/* Initial Data (Snapshot) */}
    <div className="space-y-2">
      ...
    </div>
  </CardContent>
</Card>
```

**Step 3: Add state reset on drawer close**

Find the `onOpenChange` prop on the Drawer component. Update it to reset form state when closing:
```tsx
<Drawer
  open={open}
  onOpenChange={(isOpen) => {
    if (!isOpen) {
      // Reset form state when drawer closes
      setSelectedVersion(null)
      setMode('regular')
      setSelectedSnapshot(null)
      setHelmValues(defaultHelmValues)
    }
    onOpenChange(isOpen)
  }}
>
```

Note: Check if `defaultHelmValues` exists or if there's an initial values constant to reset to.

**Step 4: Verify and commit**

Run: `cd web-ui-next && npm run dev`
- Essential fields appear in a dashed-border card
- Close and reopen drawer - form resets to defaults

```bash
git add web-ui-next/components/deploy-drawer.tsx
git commit -m "refactor(drawer): group essentials in card, reset state on close"
```

---

## Summary of Changes

After all tasks:
1. ~~Custom name~~ removed (broken feature)
2. HelmValuesEditor wrapped in "Advanced Configuration" accordion (collapsed by default)
3. Essential fields grouped in Card component with dashed border
4. Form state resets when drawer closes
5. Cleaner imports (removed Collapsible, added Accordion + Card)

**Visual Flow:**
```
┌─────────────────────────────────┐
│ Deploy New Version         [X] │
├─────────────────────────────────┤
│ ┌ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┐ │
│   Version    [1.92.0 ▾]       │ │
│ │ Quick: 1.92 | 1.91 | 1.90   │ │
│                               │ │
│ │ Mode       ○ Queue ● Reg    │ │
│                               │ │
│ │ Snapshot   [None ▾]         │ │
│ └ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┘ │
│                                 │
│ ▶ Advanced Configuration        │
│   (accordion - collapsed)       │
│                                 │
│ ⚠ Capacity warning (if needed) │
├─────────────────────────────────┤
│              [Deploy]           │
└─────────────────────────────────┘
```
