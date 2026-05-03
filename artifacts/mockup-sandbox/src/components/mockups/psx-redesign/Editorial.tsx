import React, { useState } from "react";
import { ArrowRight, ChevronDown, Menu, Check } from "lucide-react";

export function Editorial() {
  const [historyFilter, setHistoryFilter] = useState("Today");
  const [portfolioFilter, setPortfolioFilter] = useState("Today");

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-zinc-100 font-sans selection:bg-[#FF4F3A] selection:text-white overflow-x-hidden">
      <div dangerouslySetInnerHTML={{
        __html: `
        <link rel="preconnect" href="https://fonts.googleapis.com">
        <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
        <link href="https://fonts.googleapis.com/css2?family=Anton&family=JetBrains+Mono:wght@400;500;700&display=swap" rel="stylesheet">
        <style>
          .font-display { font-family: 'Anton', sans-serif; }
          .font-mono { font-family: 'JetBrains Mono', monospace; }
          .text-coral { color: #FF4F3A; }
          .bg-coral { background-color: #FF4F3A; }
          .border-coral { border-color: #FF4F3A; }
          
          @keyframes marquee {
            0% { transform: translateX(0); }
            100% { transform: translateX(-50%); }
          }
          .animate-marquee {
            animation: marquee 20s linear infinite;
          }
          
          /* Hairline grid background */
          .bg-grid {
            background-image: linear-gradient(to right, #1f1f1f 1px, transparent 1px), linear-gradient(to bottom, #1f1f1f 1px, transparent 1px);
            background-size: 64px 64px;
          }

          .drop-cap::first-letter {
            float: left;
            font-family: 'Anton', sans-serif;
            font-size: 5rem;
            line-height: 0.8;
            padding-top: 4px;
            padding-right: 8px;
            color: #FF4F3A;
          }

          /* Notched corner utilities */
          .clip-notched {
            clip-path: polygon(0 0, calc(100% - 12px) 0, 100% 12px, 100% 100%, 0 100%);
          }
          .clip-notched-br {
            clip-path: polygon(0 0, 100% 0, 100% calc(100% - 12px), calc(100% - 12px) 100%, 0 100%);
          }
        </style>
      `}} />

      {/* Marquee Ticker */}
      <div className="w-full overflow-hidden border-b border-[#2a2a2a] bg-[#0a0a0a] py-1.5 flex items-center shrink-0">
        <div className="flex w-[200%] animate-marquee whitespace-nowrap font-mono text-[10px] tracking-widest text-zinc-400">
          <div className="flex-1 flex justify-around items-center">
            <span className="flex items-center"><span className="text-white font-bold mr-2">OGDC</span><span className="text-coral">+2.4%</span></span>
            <span className="text-zinc-600">·</span>
            <span className="flex items-center"><span className="text-white font-bold mr-2">LUCK</span><span>−1.1%</span></span>
            <span className="text-zinc-600">·</span>
            <span className="flex items-center"><span className="text-white font-bold mr-2">ENGRO</span><span className="text-coral">+3.8%</span></span>
            <span className="text-zinc-600">·</span>
            <span className="flex items-center"><span className="text-white font-bold mr-2">HBL</span><span>−0.4%</span></span>
            <span className="text-zinc-600">·</span>
            <span className="flex items-center"><span className="text-white font-bold mr-2">SYS</span><span className="text-coral">+5.1%</span></span>
            <span className="text-zinc-600">·</span>
            <span className="flex items-center"><span className="text-white font-bold mr-2">MARI</span><span className="text-coral">+1.2%</span></span>
            <span className="text-zinc-600">·</span>
            <span className="flex items-center"><span className="text-white font-bold mr-2">TRG</span><span>−2.8%</span></span>
          </div>
          <div className="flex-1 flex justify-around items-center">
            <span className="flex items-center"><span className="text-white font-bold mr-2">OGDC</span><span className="text-coral">+2.4%</span></span>
            <span className="text-zinc-600">·</span>
            <span className="flex items-center"><span className="text-white font-bold mr-2">LUCK</span><span>−1.1%</span></span>
            <span className="text-zinc-600">·</span>
            <span className="flex items-center"><span className="text-white font-bold mr-2">ENGRO</span><span className="text-coral">+3.8%</span></span>
            <span className="text-zinc-600">·</span>
            <span className="flex items-center"><span className="text-white font-bold mr-2">HBL</span><span>−0.4%</span></span>
            <span className="text-zinc-600">·</span>
            <span className="flex items-center"><span className="text-white font-bold mr-2">SYS</span><span className="text-coral">+5.1%</span></span>
            <span className="text-zinc-600">·</span>
            <span className="flex items-center"><span className="text-white font-bold mr-2">MARI</span><span className="text-coral">+1.2%</span></span>
            <span className="text-zinc-600">·</span>
            <span className="flex items-center"><span className="text-white font-bold mr-2">TRG</span><span>−2.8%</span></span>
          </div>
        </div>
      </div>

      <div className="max-w-[1400px] mx-auto px-6 lg:px-12 pt-8 pb-24">
        
        {/* Navigation */}
        <nav className="flex items-center justify-between border-b border-[#2a2a2a] pb-6 mb-16">
          <div className="flex items-baseline gap-12">
            <div className="font-display text-3xl tracking-wide uppercase">PSX INSIGHT</div>
            <div className="hidden lg:flex gap-8 font-mono text-xs tracking-widest text-zinc-400">
              <a href="#" className="text-white hover:text-coral transition-colors">DASHBOARD</a>
              <a href="#" className="hover:text-white transition-colors">MARKETS</a>
              <a href="#" className="hover:text-white transition-colors">PORTFOLIO</a>
              <a href="#" className="hover:text-white transition-colors">NEWS</a>
              <a href="#" className="hover:text-white transition-colors">ANALYSIS</a>
            </div>
          </div>
          
          <div className="font-mono text-[10px] tracking-widest bg-[#111] border border-[#2a2a2a] px-3 py-1.5 flex items-center gap-2">
            <div className="w-1.5 h-1.5 bg-coral rounded-full animate-pulse" />
            <span className="text-zinc-300">MARKET CLOSED <span className="text-zinc-600 mx-1">/</span> AS OF FRI 01 MAY 2026 <span className="text-zinc-600 mx-1">/</span> 16:30 PKT</span>
          </div>
        </nav>

        {/* Hero Section */}
        <section className="mb-24 flex flex-col lg:flex-row gap-12 items-end">
          <div className="flex-1 relative">
            <div className="font-mono text-coral text-sm tracking-widest mb-4 flex items-center gap-3">
              <span className="block w-4 h-px bg-coral"></span>
              KSE-100 INDEX
              <span className="text-zinc-500">/ DAILY CLOSE</span>
            </div>
            <h1 className="font-display text-[150px] sm:text-[200px] lg:text-[240px] leading-[0.8] tracking-tight -ml-2 text-white">
              102,847
            </h1>
            <div className="flex items-baseline gap-6 mt-4 pl-2">
              <div className="font-display text-5xl lg:text-7xl text-coral tracking-wider">
                −412.18
              </div>
              <div className="font-mono text-xl lg:text-2xl text-coral bg-coral/10 px-3 py-1">
                −0.40%
              </div>
            </div>
          </div>

          <div className="w-full lg:w-80 shrink-0 flex flex-col gap-6">
            <div className="h-32 border-l border-b border-[#2a2a2a] relative flex items-end">
              {/* Fake Bar Chart */}
              <div className="w-full flex items-end justify-between px-2 h-full gap-1">
                {[40, 50, 45, 60, 30, 20, 25, 40, 55, 70, 65, 80, 75, 50, 30, 45, 35, 20, 40, 30].map((h, i) => (
                  <div key={i} className={`w-full ${i > 14 ? 'bg-coral' : 'bg-zinc-800'}`} style={{ height: `${h}%` }}></div>
                ))}
              </div>
              <div className="absolute top-0 right-0 font-mono text-[10px] text-zinc-500 border-b border-[#2a2a2a] pb-1">INTRADAY</div>
            </div>
            
            <div className="flex flex-col gap-3 font-mono text-sm uppercase tracking-widest">
              <button className="w-full bg-white text-black py-4 px-6 hover:bg-zinc-200 transition-colors flex items-center justify-between group clip-notched">
                <span>View Markets</span>
                <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
              </button>
              <button className="w-full bg-transparent border border-[#2a2a2a] text-white py-4 px-6 hover:border-coral transition-colors flex items-center justify-between group clip-notched-br">
                <span>Run AI Briefing</span>
                <span className="text-coral">→</span>
              </button>
            </div>
          </div>
        </section>

        {/* Content Grid */}
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-16 lg:gap-24">
          
          {/* Main Editorial Column */}
          <div className="xl:col-span-8 flex flex-col gap-24">
            
            {/* AI Briefing Story */}
            <article>
              <div className="flex items-center justify-between border-b-2 border-coral pb-4 mb-8">
                <div className="flex items-center gap-4">
                  <span className="font-mono text-sm bg-coral text-white px-2 py-0.5 font-bold">001</span>
                  <span className="font-mono text-sm tracking-widest text-zinc-400">THE TAPE TODAY</span>
                </div>
                
                <div className="relative group cursor-pointer font-mono text-xs tracking-widest flex items-center gap-2 border border-[#2a2a2a] px-3 py-1.5 hover:border-zinc-500 transition-colors">
                  <span className="text-zinc-400">HISTORY:</span>
                  <span className="text-white">{historyFilter}</span>
                  <ChevronDown className="w-3 h-3 text-zinc-400" />
                  
                  {/* Dropdown (hidden, hover to show in real app) */}
                  <div className="hidden group-hover:block absolute top-full right-0 mt-1 w-48 bg-[#111] border border-[#2a2a2a] z-10 shadow-2xl">
                    <div className="p-2 space-y-1">
                      {["Today", "Yesterday", "Last week", "Pick a date"].map(opt => (
                        <div key={opt} className={`px-3 py-2 text-left hover:bg-zinc-800 transition-colors ${historyFilter === opt ? 'text-coral' : 'text-zinc-300'}`}>
                          {opt}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              <h2 className="font-display text-5xl lg:text-7xl leading-[0.9] tracking-wide mb-8 uppercase">
                Energy Sector Drags Index Down as Foreign Selling Accelerates
              </h2>
              
              <div className="font-sans text-lg lg:text-xl text-zinc-300 leading-relaxed max-w-3xl space-y-6">
                <p className="drop-cap">
                  The KSE-100 index shed 412 points today, closing at 102,847.32, marking a 0.40% decline in a session dominated by aggressive foreign institutional selling in the E&P sector. Despite early morning resilience, the market succumbed to technical resistance near the 103,500 level. Volume remained relatively robust at 384 million shares, though trading was highly concentrated in second-tier cement and tech names.
                </p>
                <p>
                  OGDC and PPL were the primary culprits, contributing a combined negative 185 points to the index. Our sentiment models indicate that this pullback was largely anticipated following last week's historic rally. The algorithm notes unusual accumulation patterns in select mid-cap pharmaceutical stocks (SEARL, AGP), suggesting a quiet sector rotation is underway while retail attention remains fixated on the energy complex.
                </p>
                <p>
                  Looking ahead to next week, the tape suggests a consolidation phase between 101,000 and 103,500. Support levels appear firm, but upside momentum will require fresh macroeconomic catalysts or a reversal in foreign flows.
                </p>
              </div>
              
              <div className="mt-12 pt-6 border-t border-[#2a2a2a]">
                <div className="font-mono text-xs tracking-widest text-zinc-500 mb-4">ARCHIVE</div>
                <div className="flex flex-wrap gap-2">
                  {["30 APR", "29 APR", "28 APR", "25 APR", "24 APR"].map(date => (
                    <button key={date} className="font-mono text-xs bg-[#111] border border-[#2a2a2a] px-3 py-1.5 hover:border-zinc-500 hover:text-white text-zinc-400 transition-colors">
                      {date}
                    </button>
                  ))}
                </div>
              </div>
            </article>

            {/* Ranked Table: Gainers & Losers */}
            <section>
              <div className="flex items-center justify-between border-b-2 border-coral pb-4 mb-8">
                <div className="flex items-center gap-4">
                  <span className="font-mono text-sm bg-coral text-white px-2 py-0.5 font-bold">002</span>
                  <span className="font-mono text-sm tracking-widest text-zinc-400">MARKET MOVERS / AS OF FRI 01 MAY 2026</span>
                </div>
                <div className="flex bg-[#111] border border-[#2a2a2a] font-mono text-xs tracking-widest">
                  <button className="px-4 py-1.5 bg-zinc-800 text-white">1D</button>
                  <button className="px-4 py-1.5 text-zinc-500 hover:text-zinc-300">1W</button>
                  <button className="px-4 py-1.5 text-zinc-500 hover:text-zinc-300">1M</button>
                </div>
              </div>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-12">
                {/* Gainers */}
                <div>
                  <h3 className="font-mono text-lg tracking-widest text-white mb-6 uppercase border-l-4 border-coral pl-3">Top Gainers</h3>
                  <div className="space-y-1">
                    {[
                      { sym: "SYS", price: "645.20", change: "+5.1%" },
                      { sym: "ENGRO", price: "342.10", change: "+3.8%" },
                      { sym: "HUBC", price: "128.45", change: "+2.9%" },
                      { sym: "MARI", price: "2,845.00", change: "+1.2%" },
                      { sym: "MEBL", price: "194.30", change: "+1.0%" }
                    ].map((stock, i) => (
                      <div key={i} className="flex items-center justify-between py-3 border-b border-[#1f1f1f] group hover:bg-[#111] transition-colors px-2">
                        <div className="font-display text-xl tracking-wider w-20">{stock.sym}</div>
                        <div className="font-mono text-zinc-400 text-sm">{stock.price}</div>
                        <div className="font-mono text-coral font-bold bg-coral/10 px-2 py-1 text-sm">{stock.change}</div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Losers */}
                <div>
                  <h3 className="font-mono text-lg tracking-widest text-zinc-500 mb-6 uppercase border-l-4 border-zinc-700 pl-3">Top Losers</h3>
                  <div className="space-y-1">
                    {[
                      { sym: "TRG", price: "72.15", change: "−2.8%" },
                      { sym: "OGDC", price: "135.80", change: "−2.4%" },
                      { sym: "PPL", price: "112.40", change: "−2.1%" },
                      { sym: "LUCK", price: "845.60", change: "−1.1%" },
                      { sym: "PSO", price: "156.20", change: "−0.8%" }
                    ].map((stock, i) => (
                      <div key={i} className="flex items-center justify-between py-3 border-b border-[#1f1f1f] group hover:bg-[#111] transition-colors px-2">
                        <div className="font-display text-xl tracking-wider text-zinc-400 w-20">{stock.sym}</div>
                        <div className="font-mono text-zinc-500 text-sm">{stock.price}</div>
                        <div className="font-mono text-zinc-300 bg-zinc-800 px-2 py-1 text-sm">{stock.change}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </section>
          </div>

          {/* Sidebar */}
          <div className="xl:col-span-4 flex flex-col gap-12">
            
            {/* Portfolio Summary */}
            <div className="border border-[#2a2a2a] bg-[#111] p-6 clip-notched relative">
              <div className="absolute top-0 right-0 bg-coral text-white font-mono text-[10px] tracking-widest px-3 py-1 font-bold">
                SYSTEM VERDICT
              </div>
              
              <div className="font-mono text-xs tracking-widest text-zinc-500 mb-6">PORTFOLIO REVIEW</div>
              
              <div className="flex items-center justify-between mb-8">
                <div>
                  <div className="text-zinc-400 font-mono text-xs mb-1">CURRENT VALUE</div>
                  <div className="font-display text-4xl text-white">Rs 4.2M</div>
                </div>
                <div className="text-right">
                  <div className="text-zinc-400 font-mono text-xs mb-1">1D RETURN</div>
                  <div className="font-mono text-coral text-lg">+1.2%</div>
                </div>
              </div>

              <div className="space-y-4 mb-8">
                <div className="flex gap-3">
                  <div className="mt-1"><Check className="w-4 h-4 text-coral" /></div>
                  <p className="text-sm text-zinc-300 leading-relaxed">Exposure to Tech sector is generating alpha against the broader market decline.</p>
                </div>
                <div className="flex gap-3">
                  <div className="mt-1"><Check className="w-4 h-4 text-coral" /></div>
                  <p className="text-sm text-zinc-300 leading-relaxed">Consider rebalancing energy holdings if OGDC drops below 130 support.</p>
                </div>
              </div>

              <div className="pt-4 border-t border-[#2a2a2a]">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[10px] tracking-widest text-zinc-500">HISTORY</span>
                  <select 
                    className="bg-transparent text-white font-mono text-xs border border-[#2a2a2a] p-1 outline-none focus:border-coral"
                    value={portfolioFilter}
                    onChange={(e) => setPortfolioFilter(e.target.value)}
                  >
                    <option className="bg-[#111]">1 MAY 2026</option>
                    <option className="bg-[#111]">15 APR 2026</option>
                    <option className="bg-[#111]">1 APR 2026</option>
                  </select>
                </div>
              </div>
            </div>

            {/* Sectors */}
            <div>
              <div className="flex items-center gap-4 border-b-2 border-[#2a2a2a] pb-4 mb-6">
                <span className="font-mono text-sm bg-zinc-800 text-zinc-400 px-2 py-0.5">003</span>
                <span className="font-mono text-sm tracking-widest text-zinc-400">SECTOR FLOWS</span>
              </div>
              
              <div className="space-y-8">
                <div>
                  <h4 className="font-mono text-xs tracking-widest text-coral mb-3">IN FAVOR</h4>
                  <div className="space-y-3">
                    {["Technology & Communication", "Commercial Banks", "Cement"].map((sector, i) => (
                      <div key={i} className="flex items-center gap-3">
                        <div className="w-1 h-8 bg-coral shrink-0" />
                        <div className="text-sm text-zinc-300 font-sans">{sector}</div>
                      </div>
                    ))}
                  </div>
                </div>
                
                <div>
                  <h4 className="font-mono text-xs tracking-widest text-zinc-500 mb-3">OUT OF FAVOR</h4>
                  <div className="space-y-3">
                    {["Oil & Gas Exploration", "Power Generation", "Textile Composite"].map((sector, i) => (
                      <div key={i} className="flex items-center gap-3">
                        <div className="w-1 h-8 bg-zinc-700 shrink-0" />
                        <div className="text-sm text-zinc-500 font-sans">{sector}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>

          </div>
        </div>
      </div>

      {/* Footer */}
      <footer className="border-t border-[#2a2a2a] bg-[#050505] py-12 px-6 lg:px-12">
        <div className="max-w-[1400px] mx-auto flex flex-col md:flex-row justify-between items-start md:items-center gap-8 font-mono text-xs text-zinc-600 tracking-widest">
          <div>
            <div className="text-white mb-2 font-display text-xl tracking-wide uppercase">PSX INSIGHT</div>
            <div>BUILT FOR THE KARACHI TAPE</div>
          </div>
          
          <div className="flex flex-wrap gap-6">
            <a href="#" className="hover:text-coral transition-colors underline decoration-coral/30 underline-offset-4">TERMS</a>
            <a href="#" className="hover:text-coral transition-colors underline decoration-coral/30 underline-offset-4">PRIVACY</a>
            <a href="#" className="hover:text-coral transition-colors underline decoration-coral/30 underline-offset-4">API</a>
            <span>v2.4.0-edge</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
