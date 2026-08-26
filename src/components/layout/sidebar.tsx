"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { signOut } from "next-auth/react";
import { cn } from "@/lib/utils";
import {
  Dna,
  Megaphone,
  Camera,
  Video,
  Settings,
  LogOut,
  ChevronDown,
  Plus,
  Check,
} from "lucide-react";

interface Brand {
  id: string;
  name: string;
  url: string;
  colors: string[];
  logoUrl: string | null;
}

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const [brands, setBrands] = useState<Brand[]>([]);
  const [activeBrandId, setActiveBrandId] = useState<string | null>(null);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/api/brands")
      .then((r) => r.json())
      .then((data) => {
        const list = Array.isArray(data) ? data : [];
        setBrands(list);
        // Only fall back to first brand if pathname doesn't already specify one
        const match = pathname.match(/^\/brands\/([^/]+)/);
        if (!match && list.length > 0) {
          setActiveBrandId(list[0].id);
        }
      });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Keep the active brand in step with the URL. Adjusting state during render
  // rather than in an effect avoids a cascading re-render, and keeps the last
  // visited brand selected after navigating away from /brands/[id].
  const brandIdFromUrl = pathname.match(/^\/brands\/([^/]+)/)?.[1] ?? null;
  if (brandIdFromUrl && brandIdFromUrl !== activeBrandId) {
    setActiveBrandId(brandIdFromUrl);
  }

  const activeBrand = brands.find((b) => b.id === activeBrandId);

  const navItems = [
    { href: activeBrandId ? `/brands/${activeBrandId}` : "/dashboard", label: "Business DNA", icon: Dna },
    { href: "/campaigns/new", label: "Campaigns", icon: Megaphone },
    { href: "/photoshoot", label: "Photoshoot", icon: Camera },
    { href: "/ugc", label: "UGC Studio", icon: Video },
    { href: "/settings", label: "Settings", icon: Settings },
  ];

  return (
    <aside className="fixed left-0 top-0 z-40 h-screen w-60 border-r border-border bg-surface flex flex-col">
      {/* Logo */}
      <div className="px-5 pt-5 pb-2">
        <Link href="/dashboard" className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-accent flex items-center justify-center">
            <Dna className="w-3.5 h-3.5 text-background" />
          </div>
          <span className="text-base font-semibold tracking-tight">
            DNA Studio
          </span>
        </Link>
      </div>

      {/* Brand Selector */}
      <div className="px-3 py-3" ref={dropdownRef}>
        <button
          onClick={() => setDropdownOpen(!dropdownOpen)}
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg border border-border bg-card hover:bg-card-hover transition-colors cursor-pointer"
        >
          {activeBrand ? (
            <>
              {activeBrand.logoUrl ? (
                <img
                  src={activeBrand.logoUrl}
                  alt={activeBrand.name}
                  className="w-6 h-6 rounded object-cover bg-white flex-shrink-0"
                />
              ) : (
                <div
                  className="w-6 h-6 rounded flex items-center justify-center text-[10px] font-bold flex-shrink-0"
                  style={{
                    backgroundColor: activeBrand.colors?.[0] || "#C9A96E",
                    color: "#111",
                  }}
                >
                  {activeBrand.name.charAt(0)}
                </div>
              )}
              <span className="text-sm font-medium truncate flex-1 text-left">
                {activeBrand.name}
              </span>
            </>
          ) : (
            <span className="text-sm text-muted flex-1 text-left">
              Select a brand
            </span>
          )}
          <ChevronDown
            className={cn(
              "w-3.5 h-3.5 text-muted transition-transform",
              dropdownOpen && "rotate-180"
            )}
          />
        </button>

        {dropdownOpen && (
          <div className="mt-1 rounded-lg border border-border bg-card shadow-xl shadow-black/30 overflow-hidden">
            {brands.map((brand) => (
              <button
                key={brand.id}
                onClick={() => {
                  setActiveBrandId(brand.id);
                  setDropdownOpen(false);
                  router.push(`/brands/${brand.id}`);
                }}
                className={cn(
                  "w-full flex items-center gap-3 px-3 py-2.5 text-sm hover:bg-card-hover transition-colors cursor-pointer",
                  brand.id === activeBrandId && "bg-accent-muted"
                )}
              >
                {brand.logoUrl ? (
                  <img
                    src={brand.logoUrl}
                    alt={brand.name}
                    className="w-5 h-5 rounded object-cover bg-white flex-shrink-0"
                  />
                ) : (
                  <div
                    className="w-5 h-5 rounded flex items-center justify-center text-[9px] font-bold flex-shrink-0"
                    style={{
                      backgroundColor: brand.colors?.[0] || "#C9A96E",
                      color: "#111",
                    }}
                  >
                    {brand.name.charAt(0)}
                  </div>
                )}
                <span className="truncate flex-1 text-left">{brand.name}</span>
                {brand.id === activeBrandId && (
                  <Check className="w-3.5 h-3.5 text-accent flex-shrink-0" />
                )}
              </button>
            ))}
            <button
              onClick={() => {
                setDropdownOpen(false);
                router.push("/brands/new");
              }}
              className="w-full flex items-center gap-3 px-3 py-2.5 text-sm text-muted hover:text-foreground hover:bg-card-hover transition-colors border-t border-border cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              Add new brand
            </button>
          </div>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 space-y-0.5">
        {navItems.map((item) => {
          const isActive =
            pathname === item.href || pathname.startsWith(item.href + "/");
          return (
            <Link
              key={item.label}
              href={item.href}
              className={cn(
                "flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors duration-150",
                isActive
                  ? "bg-accent-muted text-accent font-medium"
                  : "text-muted hover:text-foreground hover:bg-card"
              )}
            >
              <item.icon className="w-4 h-4" />
              {item.label}
            </Link>
          );
        })}
      </nav>

      {/* Sign out */}
      <div className="p-3 border-t border-border">
        <button
          onClick={() => signOut({ callbackUrl: "/" })}
          className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-muted hover:text-foreground hover:bg-card transition-colors w-full cursor-pointer"
        >
          <LogOut className="w-4 h-4" />
          Sign Out
        </button>
      </div>
    </aside>
  );
}
