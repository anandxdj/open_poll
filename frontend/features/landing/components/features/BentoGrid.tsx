"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { 
  BarChart3, 
  Fingerprint, 
  Globe, 
  Layers,
  Brain,
  Check,
  Code2,
  Link2,
  Shield,
  Palette,
  Cpu
} from "lucide-react";
import { ProductLogo } from "@/components/ui/ProductLogo";

const ProductLogoIcon = (props: any) => <ProductLogo size={24} {...props} />;
import { cn } from "@/lib/utils";
import { Progress } from "@/components/ui/progress";

const ease = [0.32, 0.72, 0, 1] as const;

const features = [
  {
    icon: ProductLogoIcon,
    title: "Real-time responses",
    description: "Watch votes stream in live as your audience participates. Every answer reflected instantly — no refresh needed.",
    accent: "text-primary",
    bg: "bg-primary/10",
    className: "md:col-span-2 lg:col-span-2",
    visual: <RealTimeVisual />,
  },
  {
    icon: ProductLogoIcon,
    title: "AI-assisted drafts",
    description: "Describe your topic and let the model propose questions and balanced options.",
    accent: "text-blue-500",
    bg: "bg-blue-500/10",
    className: "md:col-span-1 lg:col-span-1",
    visual: <AiAssistedVisual />,
  },
  {
    icon: BarChart3,
    title: "Live analytics",
    description: "Visualize response distributions and track completion rates for every poll.",
    accent: "text-cyan-500",
    bg: "bg-cyan-500/10",
    className: "md:col-span-1 lg:col-span-1",
    visual: <LiveAnalyticsVisual />,
  },
  {
    icon: Fingerprint,
    title: "Anonymous by default",
    description: "Respondents can vote without accounts. Full anonymity mode keeps identifiers out.",
    accent: "text-indigo-500",
    bg: "bg-indigo-500/10",
    className: "md:col-span-1 lg:col-span-1",
    visual: <AnonymousVisual />,
  },
  {
    icon: Globe,
    title: "Share anywhere",
    description: "Every poll gets a clean, shareable link that works on any device.",
    accent: "text-sky-500",
    bg: "bg-sky-500/8",
    className: "md:col-span-1 lg:col-span-1",
    visual: <ShareVisual />,
  },
  {
    icon: Layers,
    title: "Multi-question surveys",
    description: "Stack as many questions as you need. Respondents flow through each one seamlessly.",
    accent: "text-blue-600",
    bg: "bg-blue-600/10",
    className: "md:col-span-1 lg:col-span-1",
    visual: <MultiQuestionVisual />,
  },
  {
    icon: Shield,
    title: "Enterprise Grade",
    description: "High-availability infrastructure with sub-millisecond latency. Built to handle millions of votes without breaking a sweat.",
    accent: "text-amber-500",
    bg: "bg-amber-500/10",
    className: "md:col-span-2 lg:col-span-2",
    visual: <EnterpriseVisual />,
  },
 
];

function RealTimeVisual() {
  const [votes, setVotes] = useState([65, 42, 88]);

  useEffect(() => {
    const interval = setInterval(() => {
      setVotes(prev => prev.map(v => {
        const jump = Math.random() > 0.7 ? Math.floor(Math.random() * 5) + 1 : 0;
        return Math.min(v + jump, 100);
      }));
    }, 2000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="absolute top-0 right-0 w-1/2 h-full opacity-20 pointer-events-none group-hover:opacity-40 transition-opacity duration-700">
       <div className="flex flex-col justify-center h-full gap-4 p-8 pr-12">
          {votes.map((v, i) => (
            <div key={i} className="space-y-2">
              <div className="flex justify-between items-center text-[10px] font-bold uppercase tracking-widest text-primary/60">
                <span>Option {i + 1}</span>
                <span>{v}%</span>
              </div>
              <Progress value={v} className="h-1 bg-primary/10" />
            </div>
          ))}
       </div>
    </div>
  );
}

function AiAssistedVisual() {
  const [text, setText] = useState("");
  const full = "Design a poll about remote work...";
  
  useEffect(() => {
    let i = 0;
    const interval = setInterval(() => {
      setText(full.slice(0, i));
      i = (i + 1) % (full.length + 10);
    }, 100);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="absolute -bottom-2 -right-2 w-32 h-32 opacity-20 group-hover:opacity-40 transition-opacity duration-700 pointer-events-none">
      <div className="relative w-full h-full rotate-12 bg-blue-500/10 border border-blue-500/20 rounded-xl p-3 flex flex-col gap-2 overflow-hidden shadow-2xl">
        <div className="flex items-center gap-1.5">
           <Brain className="size-3 text-blue-500" />
           <div className="h-1.5 w-12 rounded-full bg-blue-500/20" />
        </div>
        <div className="text-[8px] font-medium leading-tight text-blue-500/80 italic">
          {text}
          <span className="inline-block w-0.5 h-2 ml-0.5 bg-blue-500 animate-pulse" />
        </div>
      </div>
    </div>
  );
}

function LiveAnalyticsVisual() {
  return (
    <div className="absolute top-0 right-0 w-32 h-32 opacity-10 group-hover:opacity-30 transition-opacity duration-700 pointer-events-none">
       <div className="flex items-end justify-center h-full gap-1 p-6">
          {[40, 70, 45, 90, 65].map((h, i) => (
            <motion.div
              key={i}
              initial={{ height: 0 }}
              whileInView={{ height: `${h}%` }}
              transition={{ 
                duration: 1, 
                delay: i * 0.1,
                repeat: Infinity,
                repeatType: "reverse",
                repeatDelay: 2
              }}
              className="w-2 bg-cyan-500 rounded-t-sm"
            />
          ))}
       </div>
    </div>
  );
}

function AnonymousVisual() {
  return (
    <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full h-full opacity-5 pointer-events-none group-hover:opacity-20 transition-opacity duration-700">
       <Fingerprint className="w-full h-full p-12 text-indigo-500 animate-pulse" strokeWidth={1} />
    </div>
  );
}

function ShareVisual() {
  return (
    <div className="absolute -top-4 -right-4 w-32 h-32 opacity-10 group-hover:opacity-30 transition-all duration-700 pointer-events-none group-hover:scale-110">
       <div className="relative w-full h-full flex items-center justify-center">
          <Link2 className="size-16 text-sky-500 -rotate-12" />
          <motion.div
            animate={{ scale: [1, 1.2, 1], opacity: [0.5, 1, 0.5] }}
            transition={{ duration: 2, repeat: Infinity }}
            className="absolute size-20 rounded-full border-2 border-sky-500/30"
          />
       </div>
    </div>
  );
}

function MultiQuestionVisual() {
  return (
    <div className="absolute bottom-0 right-0 w-1/2 h-full opacity-10 group-hover:opacity-30 transition-opacity duration-700 pointer-events-none">
       <div className="flex flex-col justify-end h-full gap-2 p-6 pb-8">
          {[1, 2, 3].map((v) => (
            <motion.div
              key={v}
              animate={{ x: [0, 5, 0] }}
              transition={{ duration: 3, delay: v * 0.5, repeat: Infinity }}
              className="h-3 w-full rounded-md bg-blue-600/40 border border-blue-600/20"
            />
          ))}
       </div>
    </div>
  );
}

function EnterpriseVisual() {
  return (
    <div className="absolute inset-0 opacity-10 group-hover:opacity-20 transition-opacity duration-700 pointer-events-none overflow-hidden">
       <div className="absolute inset-0 flex items-center justify-center">
          <div className="grid grid-cols-8 gap-4 rotate-12 scale-150">
             {Array.from({ length: 32 }).map((_, i) => (
               <motion.div
                 key={i}
                 animate={{ 
                   opacity: [0.2, 0.5, 0.2],
                   scale: [1, 1.05, 1]
                 }}
                 transition={{ 
                   duration: 4, 
                   delay: (i % 8) * 0.2 + Math.floor(i / 8) * 0.2,
                   repeat: Infinity 
                 }}
                 className="size-8 rounded-lg border border-amber-500/30 flex items-center justify-center"
               >
                  <Cpu className="size-4 text-amber-500/50" strokeWidth={1} />
               </motion.div>
             ))}
          </div>
       </div>
       <div className="absolute inset-0 bg-gradient-to-t from-card via-transparent to-card" />
    </div>
  );
}

function BrandingVisual() {
  return (
    <div className="absolute inset-0 opacity-20 group-hover:opacity-40 transition-opacity duration-1000 pointer-events-none overflow-hidden">
       <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[150%] h-[150%]">
          <motion.div
            animate={{ 
              rotate: 360,
              scale: [1, 1.1, 1]
            }}
            transition={{ 
              duration: 20, 
              repeat: Infinity, 
              ease: "linear" 
            }}
            className="w-full h-full bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-rose-500/20 via-primary/10 to-transparent blur-3xl"
          />
       </div>
       <div className="absolute inset-0 flex items-center justify-center">
          <div className="flex gap-4">
             {[1, 2, 3, 4].map((i) => (
               <motion.div
                 key={i}
                 initial={{ y: 20, opacity: 0 }}
                 whileInView={{ y: 0, opacity: 1 }}
                 transition={{ delay: i * 0.1 }}
                 className="size-16 rounded-2xl bg-white/5 border border-white/10 backdrop-blur-md flex items-center justify-center shadow-2xl"
               >
                  <div 
                    className={cn(
                      "size-8 rounded-full shadow-inner",
                      i === 1 && "bg-primary",
                      i === 2 && "bg-rose-500",
                      i === 3 && "bg-blue-500",
                      i === 4 && "bg-amber-500"
                    )} 
                  />
               </motion.div>
             ))}
          </div>
       </div>
    </div>
  );
}

export function BentoGrid() {
  return (
    <section id="features" className="px-6 pt-28 pb-32">
      <div className="max-w-7xl mx-auto">
        <div className="text-center space-y-4 mb-20">
          <div className="inline-flex items-center gap-2 rounded-full border border-border bg-secondary/50 px-3 py-1.5 text-xs font-medium tracking-tight text-muted-foreground">
            <Layers className="size-3 text-primary" />
            Features
          </div>
          <h2 className="text-4xl sm:text-5xl font-bold tracking-tight text-balance">
            Everything you need
          </h2>
          <p className="max-w-xl mx-auto text-muted-foreground text-lg text-pretty leading-relaxed">
            A complete toolkit for running live polls: builder, sharing, and results in one place.
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-3 lg:grid-cols-3">
          {features.map((f, i) => (
            <FeatureCard key={f.title} feature={f} index={i} />
          ))}
        </div>
      </div>
    </section>
  );
}

function FeatureCard({ feature, index }: { feature: any; index: number }) {
  const Icon = feature.icon;
  return (
    <motion.div
      initial={{ opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-50px" }}
      transition={{ duration: 0.5, ease, delay: index * 0.06 }}
      className={cn(
        "group relative rounded-[2rem] border border-border bg-card p-8 overflow-hidden transition-all duration-500 hover:border-primary/20 hover:shadow-2xl hover:shadow-primary/5",
        feature.className
      )}
    >
      <div className="absolute inset-0 rounded-[2rem] bg-gradient-to-br from-primary/[0.03] to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-700" />
      
      {feature.visual}

      <div className="relative h-full flex flex-col justify-between space-y-8">
        <div
          className={cn(
            "inline-flex size-14 items-center justify-center rounded-2xl ring-1 ring-border shadow-sm transition-transform duration-500 group-hover:scale-110 group-hover:rotate-3",
            feature.bg
          )}
        >
          <Icon className={cn("size-6", feature.accent)} strokeWidth={1.5} />
        </div>
        <div className="space-y-3">
          <h3 className="text-xl font-bold text-foreground/90">{feature.title}</h3>
          <p className="text-base text-muted-foreground leading-relaxed">
            {feature.description}
          </p>
        </div>
      </div>
    </motion.div>
  );
}
