"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const ITENS = [
  { href: "/", rotulo: "Centro de operações" },
  { href: "/simulador", rotulo: "Simulador de pagamento" },
  { href: "/decisao", rotulo: "Motor de decisão" },
  { href: "/lab", rotulo: "Data Science Lab" },
  { href: "/mlops", rotulo: "Engenharia e MLOps" },
];

export default function Navegacao() {
  const atual = usePathname();
  return (
    <nav className="nav">
      {ITENS.map((i, k) => (
        <Link key={i.href} href={i.href} aria-current={atual === i.href ? "page" : undefined}>
          <span className="num">0{k + 1}</span>
          {i.rotulo}
        </Link>
      ))}
    </nav>
  );
}
