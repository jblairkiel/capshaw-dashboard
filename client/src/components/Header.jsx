export default function Header() {
  return (
    <header className="bg-church-navy text-white">
      <div className="max-w-6xl mx-auto px-4 py-5 flex items-center gap-4">
        {/* Cross icon */}
        <div className="flex-shrink-0">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="currentColor"
            className="w-10 h-10 text-church-gold"
          >
            <path d="M11 2h2v7h7v2h-7v11h-2V11H4V9h7V2z" />
          </svg>
        </div>
        <div>
          <h1 className="text-2xl font-serif font-bold tracking-wide">
            Capshaw Church of Christ
          </h1>
          <p className="text-church-gold text-sm tracking-widest uppercase font-medium mt-0.5">
            Worship Dashboard
          </p>
        </div>
        <div className="ml-auto text-right text-sm text-gray-300">
          <p>{new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</p>
          <p className="text-xs text-gray-400 mt-0.5">8941 Wall Triana Hwy &bull; Harvest, AL 35749</p>
        </div>
      </div>
    </header>
  );
}
