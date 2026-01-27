import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { ArrowRight, Sparkles, Users, Folder, Zap } from 'lucide-react'

export default function HomePage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-muted/30">
      {/* Hero */}
      <div className="container mx-auto px-4 py-16 md:py-24">
        <div className="max-w-3xl mx-auto text-center space-y-6">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary/10 text-primary text-sm font-medium">
            <Sparkles className="w-4 h-4" />
            Welcome to Edge
          </div>

          <h1 className="text-4xl md:text-6xl font-bold tracking-tight">
            Connect. Collaborate.{' '}
            <span className="text-primary">Create.</span>
          </h1>

          <p className="text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto">
            The professional social network where you can find projects,
            connect with talented people, and build amazing things together.
          </p>

          <div className="flex flex-col sm:flex-row gap-4 justify-center pt-4">
            <Button size="lg" asChild>
              <Link href="/signup">
                Get Started
                <ArrowRight className="w-4 h-4 ml-2" />
              </Link>
            </Button>
            <Button size="lg" variant="outline" asChild>
              <Link href="/login">Sign In</Link>
            </Button>
          </div>
        </div>

        {/* Features */}
        <div className="grid md:grid-cols-3 gap-8 mt-24 max-w-5xl mx-auto">
          <div className="text-center space-y-3">
            <div className="mx-auto w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center">
              <Users className="w-6 h-6 text-primary" />
            </div>
            <h3 className="text-xl font-semibold">Build Your Network</h3>
            <p className="text-muted-foreground">
              Connect with professionals who share your interests and goals
            </p>
          </div>

          <div className="text-center space-y-3">
            <div className="mx-auto w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center">
              <Folder className="w-6 h-6 text-primary" />
            </div>
            <h3 className="text-xl font-semibold">Discover Projects</h3>
            <p className="text-muted-foreground">
              Find exciting projects looking for collaborators like you
            </p>
          </div>

          <div className="text-center space-y-3">
            <div className="mx-auto w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center">
              <Zap className="w-6 h-6 text-primary" />
            </div>
            <h3 className="text-xl font-semibold">Showcase Your Work</h3>
            <p className="text-muted-foreground">
              Build your portfolio and demonstrate your expertise
            </p>
          </div>
        </div>
      </div>

      {/* Footer */}
      <footer className="border-t py-8 mt-16">
        <div className="container mx-auto px-4 flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-primary text-primary-foreground flex items-center justify-center font-bold">
              E
            </div>
            <span className="font-semibold">Edge</span>
          </div>
          <p className="text-sm text-muted-foreground">
            © 2026 Edge. All rights reserved.
          </p>
        </div>
      </footer>
    </div>
  )
}
