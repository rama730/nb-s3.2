'use client'

import { useRef } from 'react'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import UsernameInput from '@/components/onboarding/UsernameInput'
import type { UsernameAvailabilityStatus } from '@/hooks/useUsernameAvailability'

export interface Step1IdentityProps {
  fullName: string
  username: string
  avatarUrl: string
  isUploadingAvatar: boolean
  onFullNameChange: (value: string) => void
  onUsernameChange: (value: string) => void
  onAvatarChange: (e: React.ChangeEvent<HTMLInputElement>) => void
  onUsernameStatusChange: (status: UsernameAvailabilityStatus) => void
}

/**
 * Step 1 — Identity layout (redesigned).
 *
 * Visual changes from the original:
 * - Avatar: 64px, compact inline row (not stacked), 2px ring using `border` color
 * - "Change photo" action beside avatar
 * - Username field with `@` prefix indicator inside input
 * - Pre-fill hints in neutral `muted-foreground` at 12px (no green, no icon)
 * - No emoji in headings, left-aligned everything
 * - Mobile: avatar centered above form (not inline row)
 */
export function Step1Identity({
  fullName,
  username,
  avatarUrl,
  isUploadingAvatar,
  onFullNameChange,
  onUsernameChange,
  onAvatarChange,
  onUsernameStatusChange,
}: Step1IdentityProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)

  return (
    <div className="space-y-6">
      {/* Avatar row: inline on desktop, centered on mobile */}
      <div
        className={cn(
          'flex items-center gap-4',
          'max-md:flex-col max-md:items-center'
        )}
      >
        <Avatar className="h-16 w-16 ring-2 ring-border">
          <AvatarImage src={avatarUrl} alt={fullName || 'Profile photo'} />
          <AvatarFallback className="text-lg bg-muted text-muted-foreground">
            {fullName.slice(0, 2).toUpperCase() || 'U'}
          </AvatarFallback>
        </Avatar>

        <input
          type="file"
          ref={fileInputRef}
          onChange={onAvatarChange}
          accept="image/*"
          className="hidden"
          aria-label="Upload profile photo"
        />

        <Button
          variant="outline"
          size="sm"
          onClick={() => fileInputRef.current?.click()}
          disabled={isUploadingAvatar}
          className="min-h-[44px] md:min-h-0"
        >
          {isUploadingAvatar ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : null}
          {isUploadingAvatar ? 'Uploading...' : 'Change photo'}
        </Button>
      </div>

      {/* Full Name field */}
      <div className="space-y-2">
        <Label htmlFor="fullName">
          Full name <span className="text-destructive">*</span>
        </Label>
        <Input
          id="fullName"
          placeholder="John Doe"
          value={fullName}
          onChange={(e) => onFullNameChange(e.target.value)}
        />
        {avatarUrl && (
          <p className="text-[12px] leading-[1.5] text-muted-foreground">
            Pre-filled from your account
          </p>
        )}
      </div>

      {/* Username field */}
      <UsernameInput
        value={username}
        onChange={onUsernameChange}
        fullName={fullName}
        onStatusChange={onUsernameStatusChange}
      />
    </div>
  )
}
