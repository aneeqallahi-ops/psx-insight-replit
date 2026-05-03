import React, { useState } from "react";
import { ArrowUpRight, ArrowDownRight, Activity, Clock, Terminal as TerminalIcon, BarChart2, Briefcase, FileText, ChevronDown } from "lucide-react";

export function Terminal() {
  return (
    <div className="min-h-screen bg-[#0a0a0a] text-gray-300 font-mono selection:bg-[#FF4F3A] selection:text-[#0a0a0a] overflow-x-hidden border-grid">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Anton&family=IBM+Plex+Mono:wght@400;500;600;700&display=swap');
        
        .font-display { font-family: 'Anton', sans-serif; letter-spacing: 0.02em; }
        .font-mono { font-family: 'IBM Plex Mono', monospace; }
        
        @keyframes marquee {
          0% { transform: translateX(0%); }
          100% { transform: translateX(-50%); }
        }
        .animate-marquee {
          display: inline-block;
          white-space: nowrap;
          animation: marquee 30s linear infinite;
        }
        .clip-notch {
          clip-path: polygon(8px 0, 100% 0, 100% calc(100% - 8px), calc(100% - 8px) 100%, 0 100%, 0 8px);
        }
        .border-grid {
          background-size: 40px 40px;
          background-image: 
            linear-gradient(to right, rgba(255, 255, 255, 0.03) 1px, transparent 1px),
            linear-gradient(to bottom, rgba(255, 255, 255, 0.03) 1px, transparent 1px);
        }
        
        /* Hide scrollbar for clean terminal look */
        ::-webkit-scrollbar { width: 6px; height: 6px; }
        ::-webkit-scrollbar-track { background: #0a0a0a; }
        ::-webkit-scrollbar-thumb { background: #333; border-radius: 0; }
        ::-webkit-scrollbar-thumb:hover { background: #FF4F3A; }
      `}</style>

      {/* 1. TOP UTILITY BAR */}
      <header className="sticky top-0 z-50 flex items-center justify-between px-4 py-2 border-b border-[#FF4F3A]/30 bg-[#0a0a0a]/95 backdrop-blur">
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2 text-[#FF4F3A]">
            <TerminalIcon className="w-5 h-5" />
            <span className="font-display tracking-widest text-xl leading-none pt-1">PSX INSIGHT</span>
          </div>
          <nav className="hidden md:flex items-center gap-4 text-xs font-semibold tracking-widest text-gray-400">
            <a href="#" className="hover:text-white transition-colors">DASHBOARD</a>
            <span className="text-[#FF4F3A]/50">·</span>
            <a href="#" className="hover:text-white transition-colors">MARKETS</a>
            <span className="text-[#FF4F3A]/50">·</span>
            <a href="#" className="hover:text-white transition-colors">PORTFOLIO</a>
            <span className="text-[#FF4F3A]/50">·</span>
            <a href="#" className="hover:text-white transition-colors">NEWS</a>
            <span className="text-[#FF4F3A]/50">·</span>
            <a href="#" className="hover:text-white transition-colors">ANALYSIS</a>
          </nav>
        </div>
        <div className="flex items-center gap-3">
          <div className="px-2 py-1 border border-[#FF4F3A]/50 bg-[#FF4F3A]/10 text-[#FF4F3A] text-[10px] font-bold tracking-widest flex items-center gap-2">
            <span className="w-1.5 h-1.5 bg-[#FF4F3A] rounded-none animate-pulse"></span>
            MARKET CLOSED · AS OF FRI 01 MAY 2026 · 16:30 PKT
          </div>
        </div>
      </header>

      {/* 3. MARQUEE TICKER STRIP */}
      <div className="w-full overflow-hidden bg-[#FF4F3A] text-[#0a0a0a] py-1 border-b border-[#0a0a0a]">
        <div className="animate-marquee font-bold text-xs tracking-widest flex gap-8">
          {[...Array(2)].map((_, i) => (
            <div key={i} className="flex gap-8 items-center">
              <span>TELEMETRY</span><span>·</span>
              <span>OGDC +2.4%</span><span>·</span>
              <span>LUCK −1.1%</span><span>·</span>
              <span>ENGRO +3.8%</span><span>·</span>
              <span>HBL +0.5%</span><span>·</span>
              <span>MCB −0.2%</span><span>·</span>
              <span>UBL +1.2%</span><span>·</span>
              <span>FFC +0.8%</span><span>·</span>
              <span>PSO −1.5%</span><span>·</span>
              <span>TRG +5.4%</span><span>·</span>
              <span>SYSTEMS +4.1%</span><span>·</span>
              <span>MARI +2.2%</span><span>·</span>
              <span>POL −0.8%</span><span>·</span>
              <span>HUBC +0.3%</span><span>·</span>
              <span>NESTLE −0.1%</span><span>·</span>
              <span>COLG +1.9%</span><span>·</span>
            </div>
          ))}
        </div>
      </div>

      <main className="p-4 md:p-6 lg:p-8 max-w-[1600px] mx-auto grid grid-cols-1 lg:grid-cols-12 gap-6 relative">
        
        {/* LEFT COLUMN: HERO & TABLES */}
        <div className="col-span-1 lg:grid-cols-1 lg:col-span-8 flex flex-col gap-6">
          
          {/* 2. HERO BLOCK */}
          <section className="relative border border-[#FF4F3A]/30 bg-[#0a0a0a] p-6 lg:p-10 clip-notch overflow-hidden group">
            <div className="absolute top-0 right-0 p-4 opacity-10 text-9xl font-display leading-none -mt-4 -mr-4 pointer-events-none">
              KSE
            </div>
            
            <div className="flex items-center gap-2 mb-4 text-[#FF4F3A] text-xs font-bold tracking-widest">
              <span>000 // MAIN TERMINAL</span>
              <div className="h-px bg-[#FF4F3A]/30 flex-grow ml-4"></div>
            </div>

            <div className="flex flex-col md:flex-row md:items-end justify-between gap-8 z-10 relative">
              <div>
                <h1 className="text-sm text-gray-400 mb-2 tracking-widest">KSE-100 INDEX</h1>
                <div className="flex items-baseline gap-4">
                  <div className="text-6xl md:text-8xl font-display text-white leading-none">102,847.32</div>
                </div>
                <div className="flex items-center gap-4 mt-2 font-mono text-sm">
                  <div className="flex items-center text-[#FF4F3A] bg-[#FF4F3A]/10 px-2 py-0.5 border border-[#FF4F3A]/30">
                    <ArrowDownRight className="w-4 h-4 mr-1" />
                    <span>−412.18 / −0.40%</span>
                  </div>
                  <div className="text-gray-500 text-xs">AS OF FRI 01 MAY 2026</div>
                </div>
              </div>
              
              <div className="flex flex-col gap-3 min-w-[200px]">
                <button className="clip-notch bg-[#FF4F3A] hover:bg-white text-[#0a0a0a] font-bold text-sm tracking-widest py-3 px-6 transition-colors flex justify-between items-center group/btn">
                  <span>VIEW MARKETS</span>
                  <Activity className="w-4 h-4 group-hover/btn:translate-x-1 transition-transform" />
                </button>
                <button className="clip-notch bg-transparent border border-[#FF4F3A] text-[#FF4F3A] hover:bg-[#FF4F3A]/10 font-bold text-sm tracking-widest py-3 px-6 transition-colors flex justify-between items-center group/btn">
                  <span>RUN AI BRIEFING</span>
                  <TerminalIcon className="w-4 h-4 group-hover/btn:translate-x-1 transition-transform" />
                </button>
              </div>
            </div>
            
            {/* Sparkline pseudo-viz */}
            <div className="mt-10 h-24 border-t border-b border-[#FF4F3A]/20 flex items-end gap-1 overflow-hidden opacity-80">
              {[...Array(60)].map((_, i) => {
                const height = 20 + Math.random() * 70;
                const isRed = Math.random() > 0.5;
                return (
                  <div 
                    key={i} 
                    className={`flex-1 ${isRed ? 'bg-[#FF4F3A]' : 'bg-gray-600'}`} 
                    style={{ height: `${height}%`, opacity: 0.3 + (i/120) }}
                  ></div>
                )
              })}
            </div>
          </section>

          {/* 4. TOP GAINERS / LOSERS */}
          <section className="flex flex-col gap-4">
            <div className="flex items-end justify-between">
              <div className="flex items-center gap-2 text-[#FF4F3A] text-xs font-bold tracking-widest w-full">
                <span>001 // MARKET MOVERS</span>
                <div className="h-px bg-[#FF4F3A]/30 flex-grow mx-4"></div>
                <div className="flex bg-[#0a0a0a] border border-[#FF4F3A]/30 text-[10px]">
                  <button className="px-3 py-1 bg-[#FF4F3A] text-[#0a0a0a]">TODAY</button>
                  <button className="px-3 py-1 hover:bg-[#FF4F3A]/10 text-gray-400">1W</button>
                  <button className="px-3 py-1 hover:bg-[#FF4F3A]/10 text-gray-400">1M</button>
                </div>
              </div>
            </div>
            <div className="text-[10px] text-gray-500 tracking-widest mb-1">AS OF FRI 01 MAY 2026 · LAST OPERATING DAY</div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Gainers */}
              <div className="border border-[#FF4F3A]/30 bg-[#0a0a0a] relative">
                <div className="absolute top-0 left-0 w-1 h-full bg-[#FF4F3A]"></div>
                <div className="p-3 border-b border-[#FF4F3A]/30 text-xs font-bold tracking-widest text-[#FF4F3A] pl-5">
                  TOP GAINERS
                </div>
                <div className="p-2 pl-5 text-sm">
                  {[
                    { sym: 'TRG', last: '78.45', chg: '+5.4%' },
                    { sym: 'SYSTEMS', last: '412.10', chg: '+4.1%' },
                    { sym: 'ENGRO', last: '298.50', chg: '+3.8%' },
                    { sym: 'OGDC', last: '112.30', chg: '+2.4%' },
                    { sym: 'MARI', last: '1540.20', chg: '+2.2%' },
                  ].map((row, i) => (
                    <div key={i} className="flex justify-between items-center py-2 border-b border-gray-800 hover:bg-[#FF4F3A]/5 transition-colors">
                      <span className="font-bold text-white w-20">{row.sym}</span>
                      <span className="text-gray-400 text-right w-20">{row.last}</span>
                      <span className="text-[#FF4F3A] text-right w-16">{row.chg}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Losers */}
              <div className="border border-gray-700 bg-[#0a0a0a] relative opacity-80 hover:opacity-100 transition-opacity">
                <div className="absolute top-0 left-0 w-1 h-full bg-gray-500"></div>
                <div className="p-3 border-b border-gray-700 text-xs font-bold tracking-widest text-gray-400 pl-5">
                  TOP LOSERS
                </div>
                <div className="p-2 pl-5 text-sm">
                  {[
                    { sym: 'PSO', last: '145.20', chg: '−1.5%' },
                    { sym: 'LUCK', last: '560.80', chg: '−1.1%' },
                    { sym: 'POL', last: '410.15', chg: '−0.8%' },
                    { sym: 'MCB', last: '134.50', chg: '−0.2%' },
                    { sym: 'NESTLE', last: '7150.00', chg: '−0.1%' },
                  ].map((row, i) => (
                    <div key={i} className="flex justify-between items-center py-2 border-b border-gray-800 hover:bg-gray-800 transition-colors">
                      <span className="font-bold text-white w-20">{row.sym}</span>
                      <span className="text-gray-400 text-right w-20">{row.last}</span>
                      <span className="text-gray-500 text-right w-16">{row.chg}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </section>

          {/* 6. SECTORS IN/OUT OF FAVOR */}
          <section className="flex flex-col gap-4 mt-4">
            <div className="flex items-center gap-2 text-[#FF4F3A] text-xs font-bold tracking-widest">
              <span>002 // SECTOR ROTATION</span>
              <div className="h-px bg-[#FF4F3A]/30 flex-grow ml-4"></div>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="border border-[#FF4F3A]/30 p-4">
                <div className="text-[10px] text-[#FF4F3A] tracking-widest mb-4">CAPITAL INFLOW</div>
                <div className="space-y-3">
                  {['TECHNOLOGY', 'E&P', 'FERTILIZER'].map((sec, i) => (
                    <div key={i}>
                      <div className="flex justify-between text-xs mb-1">
                        <span className="text-white">{sec}</span>
                        <span className="text-[#FF4F3A]">{14 - i*3}%</span>
                      </div>
                      <div className="w-full h-1 bg-gray-800">
                        <div className="h-full bg-[#FF4F3A]" style={{width: `${80 - i*15}%`}}></div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="border border-gray-700 p-4">
                <div className="text-[10px] text-gray-500 tracking-widest mb-4">CAPITAL OUTFLOW</div>
                <div className="space-y-3">
                  {['CEMENT', 'OMC', 'TEXTILE'].map((sec, i) => (
                    <div key={i}>
                      <div className="flex justify-between text-xs mb-1">
                        <span className="text-gray-400">{sec}</span>
                        <span className="text-gray-500">−{8 - i*2}%</span>
                      </div>
                      <div className="w-full h-1 bg-gray-800">
                        <div className="h-full bg-gray-500" style={{width: `${60 - i*10}%`}}></div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </section>

        </div>

        {/* RIGHT COLUMN: AI BRIEFING & PORTFOLIO */}
        <div className="col-span-1 lg:col-span-4 flex flex-col gap-6">
          
          {/* 5. AI MARKET BRIEFING */}
          <section className="border border-[#FF4F3A] bg-[#FF4F3A]/5 clip-notch flex flex-col h-full relative">
            <div className="absolute top-0 right-0 w-16 h-16 bg-[#FF4F3A]/10 flex items-start justify-end p-2 pointer-events-none">
              <div className="w-2 h-2 bg-[#FF4F3A]"></div>
            </div>
            
            <div className="p-4 border-b border-[#FF4F3A]/30 flex justify-between items-center bg-[#0a0a0a]">
              <div className="flex items-center gap-2">
                <div className="bg-[#FF4F3A] text-[#0a0a0a] text-[10px] font-bold px-1 py-0.5">003</div>
                <span className="text-[#FF4F3A] font-bold text-xs tracking-widest">AI BRIEFING</span>
              </div>
              
              <div className="flex items-center gap-1 border border-[#FF4F3A]/50 bg-black px-2 py-1 cursor-pointer hover:bg-[#FF4F3A]/10">
                <span className="text-[10px] text-[#FF4F3A]">TODAY</span>
                <ChevronDown className="w-3 h-3 text-[#FF4F3A]" />
              </div>
            </div>

            <div className="p-5 flex-grow">
              <h2 className="font-display text-3xl text-white leading-tight mb-4 uppercase">
                Tech leads rally while energy slumps
              </h2>
              
              <div className="space-y-4 text-sm text-gray-400 leading-relaxed font-mono">
                <p>
                  <span className="text-[#FF4F3A] font-bold">SYNOPSIS:</span> The KSE-100 closed slightly lower today as profit-taking in the energy sector offset strong gains in technology and fertilizer names. Market participation remains concentrated in mid-tier growth stocks.
                </p>
                <p>
                  <span className="text-white">SYSTEMS</span> and <span className="text-white">TRG</span> saw abnormal volume spikes in the final hour of trading, suggesting institutional accumulation ahead of earnings season.
                </p>
                <p>
                  <span className="text-gray-500">WARNING:</span> RSI divergence on the 4-hour chart indicates the broader index may consolidate around the 102k level before attempting another breakout.
                </p>
              </div>
            </div>

            <div className="mt-auto border-t border-[#FF4F3A]/30 p-4 bg-[#0a0a0a]">
              <div className="text-[10px] text-gray-500 mb-2 tracking-widest">ARCHIVE // PREVIOUS REPORTS</div>
              <div className="flex flex-wrap gap-2 text-xs">
                {['30 APR', '29 APR', '28 APR', '25 APR'].map((date) => (
                  <a key={date} href="#" className="border border-gray-700 px-2 py-1 text-gray-400 hover:text-[#FF4F3A] hover:border-[#FF4F3A] transition-colors">
                    {date}
                  </a>
                ))}
              </div>
            </div>
          </section>

          {/* 7. PORTFOLIO REVIEW */}
          <section className="border border-gray-700 bg-black p-5 relative">
            <div className="absolute top-0 right-0 p-2">
              <Briefcase className="w-4 h-4 text-gray-500" />
            </div>
            
            <div className="flex items-center gap-2 text-gray-400 text-xs font-bold tracking-widest mb-4">
              <span>004 // PORTFOLIO DIAGNOSTIC</span>
            </div>
            
            <div className="flex items-start gap-4 mb-4">
              <div className="bg-[#FF4F3A] text-[#0a0a0a] font-display text-2xl px-3 py-1 flex items-center justify-center">
                B+
              </div>
              <div>
                <div className="text-white text-sm font-bold">NEEDS REBALANCING</div>
                <div className="text-gray-500 text-xs mt-1">Heavy tech exposure, light defensive.</div>
              </div>
            </div>
            
            <div className="flex justify-between items-center pt-4 border-t border-gray-800 text-[10px] tracking-widest">
              <a href="#" className="text-[#FF4F3A] hover:underline underline-offset-4">VIEW FULL REPORT</a>
              
              <div className="flex items-center gap-1 border border-gray-700 px-2 py-1 text-gray-400 cursor-pointer hover:bg-gray-800">
                <span>HISTORY</span>
                <ChevronDown className="w-3 h-3" />
              </div>
            </div>
          </section>

        </div>
      </main>

      {/* 8. FOOTER */}
      <footer className="border-t border-[#FF4F3A]/30 bg-[#0a0a0a] mt-12 py-6 px-4 md:px-8 text-[10px] tracking-widest font-mono text-gray-600">
        <div className="max-w-[1600px] mx-auto flex flex-col md:flex-row justify-between items-center gap-4">
          <div className="flex gap-4">
            <span>SYS_VER 2.4.19</span>
            <span className="hidden md:inline">·</span>
            <span>NODE: LHE-01</span>
          </div>
          
          <div className="text-center font-bold text-gray-500">
            BUILT FOR THE KARACHI TAPE
          </div>
          
          <div className="flex gap-4">
            <a href="#" className="text-[#FF4F3A] hover:underline underline-offset-2">DOCS</a>
            <a href="#" className="text-[#FF4F3A] hover:underline underline-offset-2">API</a>
            <a href="#" className="text-[#FF4F3A] hover:underline underline-offset-2">SUPPORT</a>
          </div>
        </div>
      </footer>

    </div>
  );
}

export default Terminal;