export default function Header() {
  return (
    <header className="bg-church-navy text-white">
      <div className="max-w-6xl mx-auto px-4 py-3 flex items-center gap-3">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="currentColor"
          className="w-7 h-7 text-church-gold shrink-0"
        >
          <path d="M11 2h2v7h7v2h-7v11h-2V11H4V9h7V2z" />
        </svg>

        <div className="min-w-0">
          <h1 className="text-base sm:text-xl font-serif font-bold tracking-wide leading-tight truncate">
            Capshaw Church of Christ
          </h1>
          <p className="text-church-gold text-xs tracking-widest uppercase font-medium hidden sm:block mt-0.5">
            Worship Dashboard
          </p>
        </div>

        <div className="ml-auto text-right text-xs text-gray-300 hidden md:block shrink-0">
          <p>{new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}</p>
          <p className="text-gray-400 mt-0.5">8941 Wall Triana Hwy &bull; Harvest, AL</p>
        </div>
      </div>
    </header>
  );
}
