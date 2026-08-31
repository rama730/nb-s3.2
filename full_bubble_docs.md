- Introduction
- Components
- Installation
- Theming
- CLI
- Typeset
- Skills
- Registry
- Changelog
 Changelog - Accordion
- Alert
- Alert Dialog
- Aspect Ratio
- Attachment
- Avatar
- Badge
- Breadcrumb
- Bubble
- Button
- Button Group
- Calendar
- Card
- Carousel
- Chart
- Checkbox
- Collapsible
- Combobox
- Command
- Context Menu
- Data Table
- Date Picker
- Dialog
- Direction
- Drawer
- Dropdown Menu
- Empty
- Field
- Hover Card
- Input
- Input Group
- Input OTP
- Item
- Kbd
- Label
- Marker
- Menubar
- Message
- Message Scroller
- Native Select
- Navigation Menu
- Pagination
- Popover
- Progress
- Radio Group
- Resizable
- Scroll Area
- Select
- Separator
- Sheet
- Sidebar
- Skeleton
- Slider
- Spinner
- Switch
- Table
- Tabs
- Textarea
- Toast
- Toggle
- Toggle Group
- Tooltip
- Typography
 Typography - Installation
- components.json
- Package Imports
- Theming
- Typeset
- Dark Mode
- CLI
- Monorepo
- Skills
- JavaScript
- Figma
- llms.txt
- Legacy Docs
 Legacy Docs - Message Scroller
 Message Scroller - AI SDK
- TanStack AI
 TanStack AI - React Hook Form
- TanStack Form
- Formisch
 Formisch - scroll-fade
- shimmer
 shimmer - Introduction
- Getting Started
- GitHub Registries
- Registry Directory
- Examples
- Namespaces
- Authentication
- MCP Server
- Open in v0
- API Reference
- registry.json
- registry-item.json
 registry-item.json 

# Bubble

Displays conversational content in a message bubble. Supports variants, alignment, grouping, reactions, and collapsible content.
 import { Bubble, BubbleContent, 
```tsx
import {
  Bubble,
  BubbleContent,
```
 Bubble 
Bubble
 Message  Bubble  Message 
Message


## Installation#
 pnpm dlx shadcn@latest add bubble 
```tsx
pnpm dlx shadcn@latest add bubble
```

```tsx
pnpm dlx shadcn@latest add bubble
```


## Usage#
 import { Bubble, BubbleContent, BubbleReactions } from "@/components/ui/bubble" 
```tsx
import { Bubble, BubbleContent, BubbleReactions } from "@/components/ui/bubble"
```
 <Bubble> <BubbleContent> I checked the registry output and removed the stale route. BubbleContent> <BubbleReactions> <span>👍span> BubbleReactions> Bubble> 
```tsx
<Bubble>
  <BubbleContent>
    I checked the registry output and removed the stale route.
  BubbleContent>
  <BubbleReactions>
    <span>👍span>
  BubbleReactions>
Bubble>
```


## Composition#

Use the following composition to build a bubble:
 Bubble ├── BubbleContent └── BubbleReactions 
```tsx
Bubble
├── BubbleContent
└── BubbleReactions
```
 BubbleGroup 
BubbleGroup
 BubbleGroup ├── Bubble │ └── BubbleContent └── Bubble └── BubbleContent 
```tsx
BubbleGroup
├── Bubble
│   └── BubbleContent
└── Bubble
    └── BubbleContent
```


## Features#
- Seven visual variants, from a strong primary bubble to unframed ghost content
- Start and end alignment for sender and receiver bubbles
- Reactions that anchor to the bubble edge with configurable side and alignment
- Bubbles size to their content, up to 80% of the container width
 render - render
 className - className
 className 

## Variants#
 variant 
variant

Ghost bubbles work for assistant text, markdown, and other content that should not be framed.
 code 
code

Ghost bubbles are full width and can take the full width of the container.
 import { Markdown } from "@/components/markdown" import { Bubble, 
```tsx
import { Markdown } from "@/components/markdown"
import {
  Bubble,
```
 default  secondary  muted  tinted  outline  ghost  destructive  ghost 
ghost


## Alignment#
 align  Bubble 
Bubble
 import { Bubble, BubbleContent } from "@/components/ui/bubble" export function BubbleAlignmentDemo() { 
```tsx
import { Bubble, BubbleContent } from "@/components/ui/bubble"

export function BubbleAlignmentDemo() {
```
 start  end  Message  Bubble  role  Message 
Message


## Bubble Group#
 BubbleGroup  align  Bubble  BubbleGroup 
BubbleGroup
 BubbleGroup ├── Bubble │ └── BubbleContent └── Bubble └── BubbleContent 
```tsx
BubbleGroup
├── Bubble
│   └── BubbleContent
└── Bubble
    └── BubbleContent
```
 import { Bubble, BubbleContent, 
```tsx
import {
  Bubble,
  BubbleContent,
```


## Links and Buttons#
 render  BubbleContent 
BubbleContent
 "use client" import { toast } from "sonner" 
```tsx
"use client"

import { toast } from "sonner"
```
 import { Bubble, BubbleContent } from "@/components/ui/bubble" export function BubbleLinkDemo() { return ( <Bubble variant="muted"> <BubbleContent render={<button />}>Click hereBubbleContent> Bubble> ) } 
```tsx
import { Bubble, BubbleContent } from "@/components/ui/bubble"
 
export function BubbleLinkDemo() {
  return (
    <Bubble variant="muted">
      <BubbleContent render={<button />}>Click hereBubbleContent>
    Bubble>
  )
}
```


## Reactions#
 BubbleReactions  side  align  side="top"  gap 
gap
 "use client" import { toast } from "sonner" 
```tsx
"use client"

import { toast } from "sonner"
```


## Show More / Collapsible#
 Collapsible  CollapsibleTrigger 
CollapsibleTrigger
 "use client" import * as React from "react" 
```tsx
"use client"

import * as React from "react"
```


## Tooltip#
 Tooltip 
Tooltip
 import { CheckIcon } from "lucide-react" import { 
```tsx
import { CheckIcon } from "lucide-react"

import {
```


## Popover#
 Popover 
Popover
 import { InfoIcon } from "lucide-react" import { 
```tsx
import { InfoIcon } from "lucide-react"

import {
```


## Accessibility#
 Bubble 
Bubble


### Labeling Reactions#
 +8  aria-label  role="img"  aria-hidden 
aria-hidden
 <BubbleReactions role="img" aria-label="Reactions: thumbs up, fire, and 8 more"> <span>👍span> <span>🔥span> <span>+8span> BubbleReactions> 
```tsx
<BubbleReactions role="img" aria-label="Reactions: thumbs up, fire, and 8 more">
  <span>👍span>
  <span>🔥span>
  <span>+8span>
BubbleReactions>
```
 aria-label 
aria-label
 <BubbleReactions> <Button aria-label="Thumbs up" variant="secondary" size="icon-xs"> <ThumbsUpIcon /> Button> BubbleReactions> 
```tsx
<BubbleReactions>
  <Button aria-label="Thumbs up" variant="secondary" size="icon-xs">
    <ThumbsUpIcon />
  Button>
BubbleReactions>
```


### Interactive Bubbles#
 render  BubbleContent 
BubbleContent
 <Bubble variant="muted" align="end"> <BubbleContent render={<button type="button" onClick={onReply} />}> I forgot my password BubbleContent> Bubble> 
```tsx
<Bubble variant="muted" align="end">
  <BubbleContent render={<button type="button" onClick={onReply} />}>
    I forgot my password
  BubbleContent>
Bubble>
```


### Meaning Beyond Color#
 destructive 
destructive


## API Reference#


### Bubble#

The root bubble wrapper.
 variant  "default" | "secondary" | "muted" | "tinted" | "outline" | "ghost" | "destructive"  "default"  align  "start" | "end"  "start"  className  string 

### BubbleContent#

The bubble content wrapper.
 render  ReactElement | function  className  string 

### BubbleReactions#

Displays overlapped reactions for a bubble.
 side  "top" | "bottom"  "bottom"  align  "start" | "end"  "end"  className  string 

### BubbleGroup#

Groups consecutive bubbles from the same sender.
 className  string 
On This Page
