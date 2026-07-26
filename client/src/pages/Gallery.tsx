import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { useLocation } from "wouter";
import { ArrowLeft, Heart, Copy, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { startLogin } from "@/const";

export default function Gallery() {
  const { isAuthenticated } = useAuth();
  const [, navigate] = useLocation();
  const utils = trpc.useUtils();

  const { data: configs, isLoading } = trpc.community.list.useQuery({ limit: 20, offset: 0 });
  const { data: myUpvotes } = trpc.community.myUpvotes.useQuery(undefined, { enabled: isAuthenticated });
  
  const upvoteMutation = trpc.community.upvote.useMutation({
    onSuccess: () => {
      utils.community.list.invalidate();
      utils.community.myUpvotes.invalidate();
    },
  });

  const cloneMutation = trpc.community.clone.useMutation({
    onSuccess: () => {
      toast.success('Engine cloned to your workspace!');
    },
    onError: () => {
      toast.error('Failed to clone. Please sign in first.');
    },
  });

  const handleUpvote = (configId: number) => {
    if (!isAuthenticated) {
      toast.error('Please sign in to upvote');
      return;
    }
    upvoteMutation.mutate({ configId });
  };

  const handleClone = (configId: number) => {
    if (!isAuthenticated) {
      toast.error('Please sign in to clone');
      return;
    }
    cloneMutation.mutate({ configId });
  };

  return (
    <div className="min-h-screen bg-dark-bg">
      {/* Header */}
      <header className="border-b border-hud-line/30 bg-dark-surface/80 backdrop-blur-sm sticky top-0 z-50">
        <div className="container flex items-center justify-between h-14">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigate('/')}
              className="text-muted-foreground hover:text-neon-cyan"
            >
              <ArrowLeft className="w-4 h-4" />
            </Button>
            <h1 className="text-sm font-[Orbitron] font-bold text-neon-cyan glow-cyan uppercase tracking-wider">
              Community Gallery
            </h1>
          </div>
          {!isAuthenticated && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => startLogin()}
              className="text-xs font-[Rajdhani] border-neon-cyan/40 text-neon-cyan hover:bg-neon-cyan/10"
            >
              Sign In
            </Button>
          )}
        </div>
      </header>

      <main className="container py-8">
        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-6 h-6 animate-spin text-neon-cyan" />
          </div>
        ) : configs && configs.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {configs.map((item: any) => {
              const cfg = item.config as any;
              const isUpvoted = myUpvotes?.includes(item.id);
              
              return (
                <div key={item.id} className="hud-panel rounded-lg p-4 border border-hud-line/20 hover:border-neon-cyan/30 transition-colors">
                  {/* Engine Info */}
                  <div className="mb-3">
                    <h3 className="text-sm font-[Orbitron] font-semibold text-foreground">{item.name}</h3>
                    <p className="text-xs font-[Rajdhani] text-muted-foreground mt-1">
                      {item.description || 'No description'}
                    </p>
                  </div>

                  {/* Config Tags */}
                  <div className="flex flex-wrap gap-1.5 mb-3">
                    {cfg?.quick && (
                      <>
                        <Tag>{cfg.quick.cylinderCount}-Cyl</Tag>
                        <Tag>{cfg.quick.layout}</Tag>
                        <Tag>{cfg.quick.crankshaft}</Tag>
                        {cfg.quick.aspiration !== 'na' && <Tag>{cfg.quick.aspiration}</Tag>}
                      </>
                    )}
                  </div>

                  {/* Author & Actions */}
                  <div className="flex items-center justify-between pt-3 border-t border-hud-line/10">
                    <span className="text-[10px] font-[Rajdhani] text-muted-foreground">
                      by {item.userName || 'Anonymous'}
                    </span>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleUpvote(item.id)}
                        className={`h-7 px-2 text-xs ${isUpvoted ? 'text-neon-pink' : 'text-muted-foreground hover:text-neon-pink'}`}
                      >
                        <Heart className={`w-3.5 h-3.5 mr-1 ${isUpvoted ? 'fill-current' : ''}`} />
                        {item.upvotes || 0}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleClone(item.id)}
                        className="h-7 px-2 text-xs text-muted-foreground hover:text-neon-cyan"
                      >
                        <Copy className="w-3.5 h-3.5 mr-1" />
                        Clone
                      </Button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="text-center py-20">
            <p className="text-sm font-[Rajdhani] text-muted-foreground">
              No community engines yet. Be the first to share your creation!
            </p>
            <Button
              onClick={() => navigate('/simulator')}
              className="mt-4 font-[Rajdhani] border-neon-pink/40 text-neon-pink hover:bg-neon-pink/10"
              variant="outline"
              size="sm"
            >
              Create an Engine
            </Button>
          </div>
        )}
      </main>
    </div>
  );
}

function Tag({ children }: { children: React.ReactNode }) {
  return (
    <span className="px-2 py-0.5 text-[10px] font-[JetBrains_Mono] text-neon-cyan/80 bg-neon-cyan/5 border border-neon-cyan/20 rounded">
      {children}
    </span>
  );
}
