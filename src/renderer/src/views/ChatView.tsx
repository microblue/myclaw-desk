export function ChatView(): React.JSX.Element {
  return (
    <div className="hero min-h-full bg-base-200">
      <div className="hero-content text-center max-w-md">
        <div>
          <h1 className="text-4xl font-bold">Ready</h1>
          <p className="py-4 text-base-content/70">
            MyClaw is installed. Daemon control + chat UI land in the next iteration.
          </p>
          <button className="btn btn-primary btn-lg" disabled>
            Press to talk
          </button>
        </div>
      </div>
    </div>
  )
}
