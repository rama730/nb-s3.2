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

# Message

Displays a message in a conversation, with optional avatar, header, footer, and alignment.
 import { Avatar, AvatarFallback, 
```tsx
import { Avatar, AvatarFallback,
```
 Message 
Message
 Message 
Message


## Installation#
 pnpm dlx shadcn@latest add message 
```tsx
pnpm dlx shadcn@latest add message
```

```tsx
pnpm dlx shadcn@latest add message
```


## Usage#
 import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar" import { Bubble, BubbleContent } from "@/components/ui/bubble" import { Message, MessageAvatar, MessageContent } from "@/components/ui/message" 
```tsx
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar" import { Bubble, BubbleContent } from "@/components/ui/bubble" import { Message, MessageAvatar, MessageContent } from "@/components/ui/message"
```
 <Message> <MessageAvatar> <Avatar> <AvatarImage src="https://github.com/shadcn.png" alt="@shadcn" /> <AvatarFallback>CNAvatarFallback> Avatar> MessageAvatar> <MessageContent> <Bubble> <BubbleContent>How can I help you today?BubbleContent> Bubble> MessageContent> Message> 
```tsx
<Message> <MessageAvatar> <Avatar> <AvatarImage src="https://github.com/shadcn.png" alt="@shadcn" /> <AvatarFallback>CNAvatarFallback> Avatar> MessageAvatar> <MessageContent> <Bubble> <BubbleContent>How can I help you today?BubbleContent> Bubble> MessageContent> Message>
```
 Message  Bubble  MessageScroller 
MessageScroller


## Composition#

Use the following composition to build a message:
 Message ├── MessageAvatar └── MessageContent ├── MessageHeader ├── Bubble └── MessageFooter 
```tsx
Message ├── MessageAvatar └── MessageContent ├── MessageHeader ├── Bubble └── MessageFooter
```
 MessageGroup 
MessageGroup
 MessageGroup ├── Message └── Message 
```tsx
MessageGroup ├── Message └── Message
```


## Features#
 align - align
- Avatar slot that anchors to the bottom of the message and stays clear of the footer
- Header and footer slots for sender names, status, and message actions
 align="end" - align="end"
- Group wrapper for stacking consecutive messages from the same sender
 className - className
 className 

## Avatar#
 MessageAvatar  align="end" 
align="end"
 import { Avatar, AvatarFallback, 
```tsx
import { Avatar, AvatarFallback,
```
 start  end 

## Group#
 MessageGroup  MessageAvatar 
MessageAvatar
 import { Avatar, AvatarFallback, 
```tsx
import { Avatar, AvatarFallback,
```


## Header and Footer#
 MessageHeader  MessageFooter 
MessageFooter
 import { Bubble, BubbleContent } from "@/components/ui/bubble" import { Message, 
```tsx
import { Bubble, BubbleContent } from "@/components/ui/bubble" import { Message,
```


## Actions#
 MessageFooter 
MessageFooter
 import { CopyIcon, RefreshCcwIcon, 
```tsx
import { CopyIcon, RefreshCcwIcon,
```


## Attachment#
 "use client" import { DownloadIcon, FileTextIcon } from "lucide-react" 
```tsx
"use client" import { DownloadIcon, FileTextIcon } from "lucide-react"
```


## Accessibility#
 Message 
Message


### Label icon-only actions#
 MessageFooter  aria-label 
aria-label
 <MessageFooter> <Button variant="ghost" size="icon" aria-label="Copy"> <CopyIcon /> Button> MessageFooter> 
```tsx
<MessageFooter> <Button variant="ghost" size="icon" aria-label="Copy"> <CopyIcon /> Button> MessageFooter>
```


### Status updates#
 Marker  role="status" 
role="status"
 <Message> <Marker role="status"> <MarkerIcon> <Spinner /> MarkerIcon> <MarkerContent>Checking the logs...MarkerContent> Marker> Message> 
```tsx
<Message> <Marker role="status"> <MarkerIcon> <Spinner /> MarkerIcon> <MarkerContent>Checking the logs...MarkerContent> Marker> Message>
```


## API Reference#


### Message#

The message row wrapper.
 align  "start" | "end"  "start"  className  string 

### MessageGroup#

Groups consecutive messages from the same sender.
 className  string 

### MessageAvatar#
 MessageFooter 
MessageFooter
 className  string 

### MessageContent#

Wraps the header, message surface, and footer.
 className  string 

### MessageHeader#
 align 
align
 className  string 

### MessageFooter#

Displays content below the message, such as status or actions. Aligns to the message side.
 className  string 
On This Page
